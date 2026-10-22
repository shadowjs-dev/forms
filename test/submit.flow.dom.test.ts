import { flushSync, useEffect } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { FormSubmitError } from "../src/index";
import { inRoot, makeForm, settle } from "./support/forms";
import { type Deferred, deferred } from "./support/schemas";

/** What a submit exposes, read the way a UI reads it. */
function stateOf(form: {
  isSubmitting(): boolean;
  isSubmitted(): boolean;
  submitCount(): number;
  isSubmitSuccessful(): boolean;
  submitError(): { readonly message: string } | undefined;
}): unknown[] {
  return [
    form.isSubmitting(),
    form.isSubmitted(),
    form.submitCount(),
    form.isSubmitSuccessful(),
    form.submitError()?.message,
  ];
}

describe("submit state", () => {
  it("[FRM-820] isSubmitting, isSubmitted, submitCount, isSubmitSuccessful and submitError across success, a returned value, a thrown Error, a FormSubmitError and an invalid form", async () => {
    const gate = deferred<void>();
    const success = makeForm({ defaultValues: { a: "x" }, onSubmit: () => gate.promise });
    const during = success.handleSubmit();
    expect(stateOf(success)).toEqual([true, true, 1, false, undefined]);
    gate.resolve();
    expect(await during).toMatchObject({ ok: true, result: undefined });
    expect(stateOf(success)).toEqual([false, true, 1, true, undefined]);

    const returned = makeForm({ defaultValues: { a: "x" }, onSubmit: async () => "saved" });
    expect(await returned.handleSubmit()).toMatchObject({ ok: true, result: "saved" });
    expect(stateOf(returned)).toEqual([false, true, 1, true, undefined]);

    const thrown = makeForm({
      defaultValues: { a: "x" },
      onSubmit: async () => {
        throw new Error("Server is on fire");
      },
    });
    const failing = thrown.handleSubmit();
    expect(stateOf(thrown)).toEqual([true, true, 1, false, undefined]);
    await failing;
    expect(stateOf(thrown)).toEqual([false, true, 1, false, "Server is on fire"]);

    const own = makeForm({
      defaultValues: { email: "a@b" },
      onSubmit: async () => {
        throw new FormSubmitError("Could not save", { fieldErrors: { email: "Taken" } });
      },
    });
    await own.handleSubmit();
    expect(stateOf(own)).toEqual([false, true, 1, false, "Could not save"]);
    expect(own.field("email").error()).toBe("Taken");

    const onSubmit = vi.fn();
    const invalid = makeForm({
      defaultValues: { a: "" },
      validators: { a: () => "Required" },
      onSubmit,
    });
    // Nothing to wait for: the refusal settles within the call.
    const refused = invalid.handleSubmit();
    expect(stateOf(invalid)).toEqual([false, true, 1, false, undefined]);
    expect(await refused).toEqual({ ok: false, reason: "invalid" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("[FRM-821] resetOnSuccess restores the defaults, which clears isSubmitted and submitCount as reset does, while isSubmitSuccessful stays true", async () => {
    const form = makeForm({
      defaultValues: { a: "x" },
      resetOnSuccess: true,
      onSubmit: () => undefined,
    });
    form.field("a").setValue("changed");
    await form.handleSubmit();
    expect(stateOf(form)).toEqual([false, false, 0, true, undefined]);
    expect(form.getValues("a")).toBe("x");
  });

  it("[FRM-822] a second submit while the first is still validating is refused as busy and is not queued: onSubmit runs once, with the first submit's values", async () => {
    const gate = deferred<undefined>();
    const onSubmit = vi.fn();
    const event = new Event("submit", { cancelable: true });
    const form = makeForm({
      defaultValues: { user: "ok" },
      validators: { user: () => gate.promise },
      onSubmit,
    });
    const first = form.handleSubmit();
    expect(form.isSubmitting()).toBe(true);
    expect(await form.handleSubmit(event)).toEqual({ ok: false, reason: "busy" });
    expect(event.defaultPrevented).toBe(true);
    expect(form.submitCount()).toBe(1);
    gate.resolve(undefined);
    expect(await first).toMatchObject({ ok: true, data: { user: "ok" } });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect([onSubmit.mock.calls.length, form.submitCount()]).toEqual([2, 2]);
  });

  it("[FRM-823] a submit that starts while a field check is in flight restarts that check and decides on its own answer; the superseded answer is ignored", async () => {
    const checks: Array<{ value: string; gate: Deferred<string | undefined> }> = [];
    const onSubmit = vi.fn();
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: (value: string) => {
          const gate = deferred<string | undefined>();
          checks.push({ value, gate });
          return gate.promise;
        },
      },
      onSubmit,
    });
    form.field("user").setValue("taken");
    const submitting = form.handleSubmit();
    expect(checks.map((check) => check.value)).toEqual(["taken", "taken"]);
    checks[1]?.gate.resolve("Already taken");
    expect(await submitting).toEqual({ ok: false, reason: "invalid" });
    checks[0]?.gate.resolve(undefined);
    await settle();
    expect(form.field("user").error()).toBe("Already taken");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("[FRM-824] a value changed while the submit waits for a check is decided: the submit waits for the check of the newest value, not the one it superseded", async () => {
    const checks: Array<{ value: string; gate: Deferred<string | undefined> }> = [];
    const onSubmit = vi.fn();
    const form = makeForm({
      defaultValues: { user: "ok" },
      validateOn: "change",
      validators: {
        user: (value: string) => {
          const gate = deferred<string | undefined>();
          checks.push({ value, gate });
          return gate.promise;
        },
      },
      onSubmit,
    });
    let decided = false;
    const submitting = form.handleSubmit().then((result) => {
      decided = true;
      return result;
    });
    expect(checks.map((check) => check.value)).toEqual(["ok"]);
    form.field("user").setValue("taken");
    expect(checks.map((check) => check.value)).toEqual(["ok", "taken"]);
    checks[0]?.gate.resolve(undefined);
    // Enough turns for the submit to notice the change and check again.
    await settle(20);
    // The answer for "ok" is superseded: the submit must still be waiting, not sending "taken".
    expect(decided).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(checks.map((check) => check.value)).toEqual(["ok", "taken", "taken"]);
    checks[checks.length - 1]?.gate.resolve("Taken");
    expect(await submitting).toEqual({ ok: false, reason: "invalid" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.field("user").error()).toBe("Taken");
  });

  it("[FRM-825] a check that keeps changing a value while the submit waits is run again at most eight times, then the submit decides on what is there", async () => {
    let calls = 0;
    const onSubmit = vi.fn();
    const form = makeForm({
      defaultValues: { user: "ok", count: 0 },
      validators: {
        user: async () => {
          calls += 1;
          form.field("count").setValue(calls);
          return undefined;
        },
      },
      onSubmit,
    });
    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect(calls).toBe(8);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("dispose during a submit", () => {
  it("[FRM-826] disposing while the validation of a submit is pending aborts its check: the late answer changes nothing and onSubmit never runs", async () => {
    const gate = deferred<string | undefined>();
    let signal: AbortSignal | undefined;
    const onSubmit = vi.fn();
    const form = makeForm({
      defaultValues: { user: "ok" },
      validators: {
        user: (_value: string, context) => {
          signal = context.signal;
          return gate.promise;
        },
      },
      onSubmit,
    });
    const pending = form.handleSubmit();
    expect([form.isSubmitting(), form.isValidating()]).toEqual([true, true]);
    form.dispose();
    expect(signal?.aborted).toBe(true);
    const frozen = [form.isSubmitting(), form.isValidating(), stateOf(form), form.errors()];
    gate.resolve("Taken");
    await settle();
    expect(await pending).toEqual({ ok: false, reason: "canceled" });
    expect([form.isSubmitting(), form.isValidating(), stateOf(form), form.errors()]).toEqual(
      frozen,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("[FRM-827] disposing while onSubmit is pending aborts its signal; a rejection that arrives later is swallowed: no submitError, no unhandled rejection, the state stays as it was", async () => {
    const gate = deferred<void>();
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
    form.dispose();
    expect(signal?.aborted).toBe(true);
    const frozen = stateOf(form);
    gate.reject(new Error("request aborted by the network stack"));
    await settle();
    expect(await pending).toEqual({ ok: false, reason: "canceled" });
    expect(stateOf(form)).toEqual(frozen);
    expect(form.submitError()).toBeUndefined();
  });
});

describe("FormSubmitError mapping", () => {
  it("[FRM-828] fieldErrors reach nested objects, array rows and bracket spellings alike; the empty key is the form's message", async () => {
    const form = makeForm({
      defaultValues: {
        address: { street: "", city: "" },
        tags: [{ label: "a" }, { label: "b" }],
      },
      onSubmit: () => {
        throw new FormSubmitError("Could not save", {
          fieldErrors: {
            "address.street": "Street missing",
            "address.city": ["Unknown city", "Too far"],
            "tags[1].label": "Second label too short",
            "tags.0.label": "First label too short",
            "": "Try again later",
          },
        });
      },
    });
    await form.handleSubmit();
    expect(form.field("address.street").error()).toBe("Street missing");
    expect(
      form
        .field("address.city")
        .errors()
        .map((issue) => issue.message),
    ).toEqual(["Unknown city", "Too far"]);
    expect(form.field("tags.1.label").error()).toBe("Second label too short");
    expect(form.fieldAt("tags[0].label").error()).toBe("First label too short");
    expect(form.formErrors().map((issue) => issue.message)).toEqual(["Try again later"]);
    expect(form.submitError()?.message).toBe("Could not save");
  });

  it("[FRM-829] after a FormSubmitError the first invalid control in document order gets focus, and shouldFocusError: false keeps the focus where it was", async () => {
    const error = (): never => {
      throw new FormSubmitError("Could not save", {
        fieldErrors: { b: "Taken", a: "Too short" },
      });
    };
    const form = makeForm({ defaultValues: { a: "x", b: "y" }, onSubmit: error });
    const inputA = document.body.appendChild(document.createElement("input"));
    const inputB = document.body.appendChild(document.createElement("input"));
    // Registered out of document order: document order decides.
    form.field("b").ref(inputB);
    form.field("a").ref(inputA);
    await form.handleSubmit();
    expect(document.activeElement).toBe(inputA);

    const quiet = makeForm({
      defaultValues: { a: "x" },
      onSubmit: error,
      shouldFocusError: false,
    });
    const other = document.body.appendChild(document.createElement("input"));
    quiet.field("a").ref(other);
    other.focus();
    await quiet.handleSubmit();
    expect(quiet.field("a").error()).toBe("Too short");
    expect(document.activeElement).toBe(other);
  });

  it("[FRM-830] the submitErrors feature scrolls the first invalid control into view (block nearest) as it focuses it, and scrolls nothing else", async () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    const form = makeForm({
      defaultValues: { a: "x", b: "y" },
      onSubmit: () => {
        throw new FormSubmitError("Could not save", { fieldErrors: { b: "Taken" } });
      },
    });
    const inputA = document.body.appendChild(document.createElement("input"));
    const inputB = document.body.appendChild(document.createElement("input"));
    form.field("a").ref(inputA);
    form.field("b").ref(inputB);
    await form.handleSubmit();
    expect(spy.mock.calls).toEqual([[{ block: "nearest" }]]);
    expect(scrolled).toEqual([inputB]);
    expect(document.activeElement).toBe(inputB);

    // With shouldFocusError: false neither the focus moves nor the view scrolls.
    const quiet = makeForm({
      defaultValues: { a: "x" },
      shouldFocusError: false,
      onSubmit: () => {
        throw new FormSubmitError("Could not save", { fieldErrors: { a: "Taken" } });
      },
    });
    const other = document.body.appendChild(document.createElement("input"));
    quiet.field("a").ref(other);
    await quiet.handleSubmit();
    expect(spy.mock.calls.length).toBe(1);
    expect(document.activeElement).not.toBe(other);
  });
});

describe("submit errors that name no field", () => {
  it("[FRM-832] a thrown error whose issues name no field (a key with a dot) ends the submit as failed with the problem on the form: the submit never rejects", async () => {
    const form = makeForm({
      defaultValues: { user: { name: "a" } },
      onSubmit: () => {
        throw Object.assign(new Error("Invalid input"), {
          issues: [{ message: "Dotted key", path: ["user.name"] }],
        });
      },
    });
    const result = await form.handleSubmit();
    expect(result).toMatchObject({ ok: false, reason: "error" });
    expect(form.formErrors().map((issue) => issue.message)).toEqual(["Dotted key"]);
    expect(form.submitError()?.message).toBe("Invalid input");
    expect(form.isSubmitting()).toBe(false);
  });
});

describe("error summary", () => {
  it("[FRM-831] an error summary links each invalid field to its id in an aria-live list, a link focuses its field, and the summary follows the errors as they clear", async () => {
    const form = makeForm({
      id: "signup",
      defaultValues: { email: "", name: "" },
      validators: {
        email: (value: string) => (value === "" ? "Email is required" : undefined),
        name: (value: string) => (value === "" ? "Name is required" : undefined),
      },
      onSubmit: () => undefined,
    });
    const root = document.body.appendChild(document.createElement("main"));
    const summary = root.appendChild(document.createElement("div"));
    summary.id = "signup-summary";
    summary.setAttribute("aria-live", "polite");
    const list = summary.appendChild(document.createElement("ul"));
    const email = root.appendChild(document.createElement("input"));
    const name = root.appendChild(document.createElement("input"));
    form.field("email").ref(email);
    form.field("name").ref(name);
    // The control attributes come from the field's own props(), read inside an effect so they follow the errors.
    for (const [path, input] of [
      ["email", email],
      ["name", name],
    ] as const) {
      const bag = form.field(path).props() as unknown as Record<string, unknown>;
      inRoot(() => {
        useEffect(() => {
          for (const attribute of ["id", "aria-invalid", "aria-describedby"] as const) {
            const value = bag[attribute];
            if (value === undefined) input.removeAttribute(attribute);
            else input.setAttribute(attribute, String(value));
          }
        });
      });
    }
    // The summary lists the invalid fields in form order (the order of the controls), not in the
    // order the engine found the problems.
    inRoot(() => {
      useEffect(() => {
        list.replaceChildren(
          ...(["email", "name"] as const).flatMap((path) => {
            const message = form.field(path).error();
            if (message === undefined) return [];
            const item = document.createElement("li");
            const link = item.appendChild(document.createElement("a"));
            link.href = `#${form.field(path).id}`;
            link.textContent = message;
            link.addEventListener("click", (event) => {
              event.preventDefault();
              form.focus(path);
            });
            return [item];
          }),
        );
      });
    });
    flushSync();
    expect(list.querySelectorAll("a").length).toBe(0);
    expect(email.getAttribute("aria-invalid")).toBeNull();

    await form.handleSubmit();
    flushSync();
    const links = Array.from(list.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#signup-email",
      "#signup-name",
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      "Email is required",
      "Name is required",
    ]);
    expect(summary.getAttribute("aria-live")).toBe("polite");
    expect(email.id).toBe("signup-email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(form.field("email").errorId);
    expect(form.field("email").errorId).toBe("signup-email-error");

    const dispatched = links[1]?.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    expect(dispatched).toBe(false);
    expect(document.activeElement).toBe(name);

    form.field("email").setValue("a@b.c");
    flushSync();
    expect(Array.from(list.querySelectorAll("a")).map((link) => link.textContent)).toEqual([
      "Name is required",
    ]);
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(email.getAttribute("aria-describedby")).toBeNull();
    expect(summary.getAttribute("aria-live")).toBe("polite");

    form.field("name").setValue("Ada");
    flushSync();
    expect(list.querySelectorAll("li").length).toBe(0);
  });
});
