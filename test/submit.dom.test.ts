import { flushSync } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FormSubmitError, submitWith } from "../src/index";
import { standardSchema } from "../src/standard-schema";
import { makeForm, settle } from "./support/forms";
import { deferred } from "./support/schemas";

const schema = z.object({
  email: z.string().min(3, "Email too short"),
  age: z.string().transform((v) => Number(v)),
});

describe("handleSubmit", () => {
  it("[FRM-90] prevents the default action, validates, calls onSubmit with the parsed output and reports the state", async () => {
    const onSubmit = vi.fn(() => "saved");
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { email: "abc", age: "7" },
      onSubmit,
    });
    const event = new Event("submit", { cancelable: true });
    const states: boolean[] = [];
    const pending = form.handleSubmit(event);
    states.push(form.isSubmitting());
    const result = await pending;
    states.push(form.isSubmitting());
    expect(event.defaultPrevented).toBe(true);
    expect(result).toEqual({ ok: true, data: { email: "abc", age: 7 }, result: "saved" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [output, context] = onSubmit.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(output).toEqual({ email: "abc", age: 7 });
    expect(context["input"]).toEqual({ email: "abc", age: "7" });
    expect(context["form"]).toBe(form);
    expect(context["event"]).toBe(event);
    expect((context["signal"] as AbortSignal).aborted).toBe(false);
    expect(states).toEqual([true, false]);
    expect([
      form.submitCount(),
      form.isSubmitted(),
      form.isSubmitSuccessful(),
      form.submitError(),
    ]).toEqual([1, true, true, undefined]);
  });

  it("[FRM-91] an invalid form is not sent; onInvalid hears the shown problems", async () => {
    const onSubmit = vi.fn();
    const onInvalid = vi.fn();
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { email: "", age: "1" },
      onSubmit,
      onInvalid,
    });
    const result = await form.handleSubmit();
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(
      (onInvalid.mock.calls[0] as unknown as [{ path: string; message: string }[]])[0],
    ).toMatchObject([{ path: "email", message: "Email too short" }]);
    expect([form.isSubmitSuccessful(), form.submitCount()]).toEqual([false, 1]);
  });

  it("[FRM-92] the first invalid control, in document order, gets focus", async () => {
    const form = makeForm({
      defaultValues: { a: "", b: "", c: "" },
      validators: {
        a: (v: string) => (v === "" ? "a!" : undefined),
        b: (v: string) => (v === "" ? "b!" : undefined),
        c: (v: string) => (v === "" ? "c!" : undefined),
      },
    });
    const inputs = ["a", "b", "c"].map(() =>
      document.body.appendChild(document.createElement("input")),
    );
    // Registered out of order on purpose: document order decides, not registration order.
    form.field("c").ref(inputs[2] as HTMLInputElement);
    form.field("b").ref(inputs[1] as HTMLInputElement);
    form.field("a").ref(inputs[0] as HTMLInputElement);
    await form.handleSubmit();
    expect(document.activeElement).toBe(inputs[0]);
    form.field("a").setValue("x");
    await form.handleSubmit();
    expect(document.activeElement).toBe(inputs[1]);
    const quiet = makeForm({
      defaultValues: { a: "" },
      validators: { a: () => "bad" },
      shouldFocusError: false,
    });
    const other = document.body.appendChild(document.createElement("input"));
    quiet.field("a").ref(other);
    await quiet.handleSubmit();
    expect(document.activeElement).not.toBe(other);
    expect(form.focus("c")).toBe(true);
    expect(document.activeElement).toBe(inputs[2]);
  });

  it("[FRM-93] a thrown error ends the submit as failed and is kept in submitError", async () => {
    const boom = new Error("Server is on fire");
    const form = makeForm({
      defaultValues: { a: "x" },
      onSubmit: () => {
        throw boom;
      },
    });
    const result = await form.handleSubmit();
    expect(result).toEqual({ ok: false, reason: "error", error: boom });
    expect(form.submitError()).toEqual({ message: "Server is on fire", cause: boom });
    expect([form.isSubmitting(), form.isSubmitSuccessful()]).toEqual([false, false]);
    await form.handleSubmit();
    expect(form.submitCount()).toBe(2);
    const quiet = makeForm({ defaultValues: { a: "x" }, onSubmit: () => Promise.reject("odd") });
    await quiet.handleSubmit();
    expect(quiet.submitError()?.message).toBe("The form could not be submitted.");
  });

  it("[FRM-94] submitting while a submit is in flight is refused and does not call onSubmit twice", async () => {
    const gate = deferred<void>();
    const onSubmit = vi.fn(() => gate.promise);
    const form = makeForm({ defaultValues: { a: "x" }, onSubmit });
    const first = form.handleSubmit();
    await settle();
    expect(await form.handleSubmit()).toEqual({ ok: false, reason: "busy" });
    gate.resolve();
    expect(await first).toMatchObject({ ok: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(form.submitCount()).toBe(1);
  });

  it("[FRM-95] a disabled form does not submit; the option may be an accessor", async () => {
    let off = true;
    const onSubmit = vi.fn();
    const form = makeForm({ defaultValues: { a: "x" }, onSubmit, disabled: () => off });
    expect(form.isDisabled()).toBe(true);
    expect(form.field("a").disabled()).toBe(true);
    expect(await form.handleSubmit()).toEqual({ ok: false, reason: "disabled" });
    off = false;
    expect(form.isDisabled()).toBe(false);
    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("[FRM-96] reset while submitting aborts the signal and discards the answer", async () => {
    const gate = deferred<string>();
    let signal: AbortSignal | undefined;
    const form = makeForm({
      defaultValues: { a: "x" },
      onSubmit: (_data, context) => {
        signal = context.signal;
        return gate.promise;
      },
    });
    const pending = form.handleSubmit();
    await settle();
    form.reset();
    expect(signal?.aborted).toBe(true);
    gate.resolve("late");
    expect(await pending).toEqual({ ok: false, reason: "canceled" });
    expect([form.isSubmitting(), form.isSubmitSuccessful(), form.submitCount()]).toEqual([
      false,
      false,
      0,
    ]);
  });

  it("[FRM-97] disposing the form during a submit cancels it", async () => {
    const gate = deferred<void>();
    const form = makeForm({ defaultValues: { a: "x" }, onSubmit: () => gate.promise });
    const pending = form.handleSubmit();
    await settle();
    form.dispose();
    gate.resolve();
    expect(await pending).toEqual({ ok: false, reason: "canceled" });
    expect(await form.handleSubmit()).toEqual({ ok: false, reason: "canceled" });
  });

  it("[FRM-98] resetOnSuccess: true restores the defaults; 'values' adopts the submitted values", async () => {
    const restore = makeForm({
      defaultValues: { a: "x" },
      resetOnSuccess: true,
      onSubmit: () => undefined,
    });
    restore.field("a").setValue("changed");
    await restore.handleSubmit();
    expect(restore.getValues("a")).toBe("x");
    expect(restore.isSubmitSuccessful()).toBe(true);

    const adopt = makeForm({
      defaultValues: { a: "x" },
      resetOnSuccess: "values",
      onSubmit: () => undefined,
    });
    adopt.field("a").setValue("saved");
    await adopt.handleSubmit();
    expect(adopt.getValues("a")).toBe("saved");
    expect(adopt.isDirty()).toBe(false);
    adopt.reset();
    expect(adopt.getValues("a")).toBe("saved");
  });

  it("[FRM-99] FormSubmitError and server validation errors are shown on the fields they name", async () => {
    const own = makeForm({
      defaultValues: { email: "a@b", name: "n" },
      onSubmit: () => {
        throw new FormSubmitError("Could not save", {
          fieldErrors: { email: "Already registered", "": "Try later", name: ["x", "y"] },
        });
      },
    });
    await own.handleSubmit();
    expect(own.field("email").error()).toBe("Already registered");
    expect(
      own
        .field("name")
        .errors()
        .map((i) => i.message),
    ).toEqual(["x", "y"]);
    expect(own.formErrors().map((i) => i.message)).toEqual(["Try later"]);
    expect(own.submitError()?.message).toBe("Could not save");

    const start = makeForm({
      defaultValues: { email: "a@b", tags: [{ label: "x" }] },
      onSubmit: () => {
        // The shape a ValidationError from @shadow-js/dusk has on the client.
        throw Object.assign(new Error("Invalid input"), {
          data: {
            issues: [
              { message: "Taken", path: ["email"] },
              { message: "Bad", path: ["tags", 0, "label"] },
            ],
          },
        });
      },
    });
    await start.handleSubmit();
    expect(start.errors()).toEqual({ email: "Taken", "tags.0.label": "Bad" });
    // Typing clears the server problem of that field.
    start.field("email").setValue("c@d");
    expect(start.field("email").error()).toBeUndefined();
    expect(start.field("tags.0.label").error()).toBe("Bad");
    // A new submit starts clean.
    await start.handleSubmit();
    expect(start.errors()["email"]).toBe("Taken");
  });

  it("[FRM-100] handleSubmitWith runs handlers of its own, for forms with several buttons", async () => {
    const save = vi.fn();
    const publish = vi.fn();
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { email: "abc", age: "1" },
      onSubmit: save,
    });
    await form.handleSubmitWith(publish)();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    const onInvalid = vi.fn();
    form.field("email").setValue("");
    expect(await form.handleSubmitWith(publish, onInvalid)()).toMatchObject({ reason: "invalid" });
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it("[FRM-101] submitWith runs a server function with the output and the signal; its thrown issues come back on the fields", async () => {
    const calls: unknown[] = [];
    const action = async (
      input: { email: string; age: number },
      options?: { signal?: AbortSignal },
    ) => {
      calls.push([input, options?.signal instanceof AbortSignal]);
      if (input.email === "taken") {
        throw Object.assign(new Error("Invalid input"), {
          issues: [{ message: "Taken", path: ["email"] }],
        });
      }
      return { id: 7 };
    };
    const after = vi.fn();
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { email: "taken", age: "3" },
      onSubmit: submitWith(action, after),
    });
    await form.handleSubmit();
    expect(calls).toEqual([[{ email: "taken", age: 3 }, true]]);
    expect(form.field("email").error()).toBe("Taken");
    expect(after).not.toHaveBeenCalled();
    form.field("email").setValue("free");
    const ok = await form.handleSubmit();
    expect(ok).toMatchObject({ ok: true, result: { id: 7 } });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("[FRM-102] props() gives a form element bag: no native validation, busy while submitting, submit handler", async () => {
    const gate = deferred<void>();
    const form = makeForm({ defaultValues: { a: "x" }, onSubmit: () => gate.promise });
    const bag = form.props();
    expect(bag.noValidate).toBe(true);
    expect(bag.id).toBe("t");
    expect(bag["aria-busy"]).toBeUndefined();
    const event = new Event("submit", { cancelable: true });
    bag.onSubmit(event);
    await settle();
    flushSync();
    expect(event.defaultPrevented).toBe(true);
    expect(bag["aria-busy"]).toBe(true);
    gate.resolve();
    await settle();
    expect(bag["aria-busy"]).toBeUndefined();
  });
});
