import { flushSync } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FormApi } from "../src/index";
import { standardSchema } from "../src/standard-schema";
import { makeForm, settle } from "./support/forms";
import { customSchema, deferred } from "./support/schemas";

afterEach(() => {
  vi.useRealTimers();
});

const signup = z.object({
  email: z.string().min(3, "Email too short"),
  password: z.string().min(4, "Password too short"),
  confirm: z.string(),
  tags: z.array(z.object({ label: z.string().min(2, "Label too short") })),
});

type SignupInput = z.input<typeof signup>;

function signupForm(
  options: Partial<Parameters<typeof makeForm<SignupInput, z.output<typeof signup>>>[0]> = {},
): FormApi<SignupInput, z.output<typeof signup>> {
  return makeForm({
    resolver: standardSchema(signup),
    defaultValues: { email: "", password: "", confirm: "", tags: [{ label: "" }] },
    ...options,
  });
}

describe("schema validation", () => {
  it("[FRM-50] schema issues are mapped to field paths; validity is known at once but nothing shows yet", () => {
    const form = signupForm();
    expect(form.isValid()).toBe(false);
    expect(form.field("email").error()).toBeUndefined();
    expect(form.errors()).toEqual({});
  });

  it("[FRM-51] default validateOn 'touched': shown after blur, then live on every change", () => {
    const form = signupForm();
    const email = form.field("email");
    email.setValue("ab");
    expect(email.error()).toBeUndefined();
    email.onBlur();
    flushSync();
    expect(email.error()).toBe("Email too short");
    email.setValue("abc");
    expect(email.error()).toBeUndefined();
    email.setValue("a");
    expect(email.error()).toBe("Email too short");
  });

  it("[FRM-52] validateOn 'change' shows on the first edit; 'blur' waits for blur and does not follow typing; 'submit' waits for a submit", () => {
    const change = signupForm({ validateOn: "change" });
    change.field("email").setValue("a");
    expect(change.field("email").error()).toBe("Email too short");

    const blur = signupForm({ validateOn: "blur" });
    blur.field("email").setValue("a");
    expect(blur.field("email").error()).toBeUndefined();
    blur.field("email").onBlur();
    expect(blur.field("email").error()).toBe("Email too short");
    blur.field("email").setValue("abc");
    expect(blur.field("email").error()).toBe("Email too short");
    blur.field("email").onBlur();
    expect(blur.field("email").error()).toBeUndefined();

    const submit = signupForm({ validateOn: "submit" });
    submit.field("email").setValue("a");
    submit.field("email").onBlur();
    expect(submit.field("email").error()).toBeUndefined();
  });

  it("[FRM-53] a mix of validateOn values applies each; mode is shorthand, validateOn wins", () => {
    const both = signupForm({ validateOn: ["blur", "change"] });
    both.field("email").setValue("a");
    expect(both.field("email").error()).toBe("Email too short");

    const onChange = signupForm({ mode: "onChange" });
    onChange.field("email").setValue("a");
    expect(onChange.field("email").error()).toBe("Email too short");

    const onSubmit = signupForm({ mode: "onSubmit" });
    onSubmit.field("email").setValue("a");
    expect(onSubmit.field("email").error()).toBeUndefined();

    const wins = signupForm({ mode: "onSubmit", validateOn: "change" });
    wins.field("email").setValue("a");
    expect(wins.field("email").error()).toBe("Email too short");
  });

  it("[FRM-54] after a submit, reValidateOn decides: 'change' (default) follows typing, 'blur' waits, 'submit' freezes", async () => {
    const live = signupForm({ validateOn: "submit" });
    await live.handleSubmit();
    expect(live.field("email").error()).toBe("Email too short");
    live.field("email").setValue("abcd");
    expect(live.field("email").error()).toBeUndefined();

    const onBlur = signupForm({ validateOn: "submit", reValidateOn: "blur" });
    await onBlur.handleSubmit();
    onBlur.field("email").setValue("abcd");
    expect(onBlur.field("email").error()).toBe("Email too short");
    onBlur.field("email").onBlur();
    expect(onBlur.field("email").error()).toBeUndefined();

    const frozen = signupForm({ validateOn: "submit", reValidateOn: "submit" });
    await frozen.handleSubmit();
    frozen.field("email").setValue("abcd");
    frozen.field("email").onBlur();
    expect(frozen.field("email").error()).toBe("Email too short");
  });

  it("[FRM-55] issue paths reach array rows, and the error follows the field", async () => {
    const form = signupForm();
    await form.handleSubmit();
    expect(form.field("tags.0.label").error()).toBe("Label too short");
    expect(form.errors()["tags.0.label"]).toBe("Label too short");
    expect(form.issues().map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["email", "password", "tags.0.label"]),
    );
  });

  it("[FRM-56] any Standard Schema works, including {key} path steps, numeric steps and async answers", async () => {
    const schema = customSchema([
      { path: [{ key: "name" }], check: (v) => (v === "" ? "Name required" : undefined) },
      {
        path: ["items", 1, { key: "qty" }],
        check: (v) => (v === 0 ? "Qty must be positive" : undefined),
      },
    ]);
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { name: "", items: [{ qty: 1 }, { qty: 0 }] } as Record<string, unknown>,
    });
    const result = await form.handleSubmit();
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(form.errors()).toEqual({ name: "Name required", "items.1.qty": "Qty must be positive" });

    const slow = customSchema(
      [{ path: ["name"], check: (v) => (v === "" ? "async required" : undefined) }],
      {
        asynchronous: true,
      },
    );
    const asyncForm = makeForm({
      resolver: standardSchema(slow),
      defaultValues: { name: "" } as Record<string, unknown>,
    });
    await asyncForm.handleSubmit();
    expect(asyncForm.errors()).toEqual({ name: "async required" });
    expect(asyncForm.isValidating()).toBe(false);
  });

  it("[FRM-57] a schema that transforms: onSubmit receives the output type, the form holds the input type", async () => {
    const schema = z.object({
      age: z.string().transform((value) => Number(value)),
      name: z.string(),
    });
    const seen: unknown[] = [];
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { age: "41", name: "Ada" },
      onSubmit: (output) => {
        seen.push(output);
      },
    });
    expect(form.getValues("age")).toBe("41");
    const result = await form.handleSubmit();
    expect(result).toMatchObject({ ok: true });
    expect(seen).toEqual([{ age: 41, name: "Ada" }]);
  });

  it("[FRM-58] a pass that fails inside the schema (a throw) becomes a form problem instead of breaking the form", async () => {
    const schema = customSchema([
      {
        path: ["a"],
        check: () => {
          throw new Error("schema exploded");
        },
      },
    ]);
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { a: "x" } as Record<string, unknown>,
    });
    const result = await form.handleSubmit();
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(form.formErrors().map((issue) => issue.message)).toEqual(["schema exploded"]);
  });

  it("[FRM-59] problems without a path belong to the form as a whole", async () => {
    const schema = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a !== v.b, "a and b must differ");
    const form = makeForm({ resolver: standardSchema(schema), defaultValues: { a: "x", b: "x" } });
    await form.handleSubmit();
    expect(form.formErrors().map((issue) => issue.message)).toEqual(["a and b must differ"]);
  });
});

describe("field validators", () => {
  it("[FRM-60] validators by pattern run on matching fields; a function result can be a string, an object or a list", async () => {
    const form = makeForm({
      defaultValues: { lines: [{ sku: "" }, { sku: "ok" }], note: "" },
      validators: {
        "lines.*.sku": (value: string) => (value === "" ? "SKU required" : undefined),
        note: (value: string) => [
          { message: "Too short", type: "min", params: { min: 5 } },
          { message: "Needs a digit", type: "digit" },
          value === "" ? undefined : "never",
        ],
      },
    });
    await form.handleSubmit();
    expect(form.errors()["lines.0.sku"]).toBe("SKU required");
    expect(form.errors()["lines.1.sku"]).toBeUndefined();
    const note = form.field("note");
    expect(note.errors().map((issue) => issue.type)).toEqual(["min", "digit"]);
    expect(note.errors()[0]?.params).toEqual({ min: 5 });
    expect(note.error()).toBe("Too short");
  });

  it("[FRM-61] a validator passed to field() lives as long as its owner and runs with the context", async () => {
    const form = makeForm({ defaultValues: { a: "x", b: "y" } });
    const calls: Array<[unknown, string, string, string]> = [];
    const a = form.field("a", {
      validate: (value, context) => {
        calls.push([value, context.path, context.trigger, JSON.stringify(context.values())]);
        return value === "x" ? "no x" : undefined;
      },
    });
    expect(form.field("a", { validate: (v) => (v === "q" ? "q" : undefined) })).toBe(a);
    await form.trigger();
    expect(a.error()).toBe("no x");
    expect(calls[0]).toEqual(["x", "a", "manual", '{"a":"x","b":"y"}']);
  });

  it("[FRM-62] cross-field validation: a rule over all values updates the other field when one changes", () => {
    const form = makeForm({
      defaultValues: { password: "abcd", confirm: "abcd" },
      validate: (values) =>
        values.password === values.confirm ? undefined : { confirm: "Must match" },
      validateOn: "change",
    });
    form.field("confirm").setValue("abcX");
    expect(form.field("confirm").error()).toBe("Must match");
    form.field("password").setValue("abcX");
    expect(form.field("confirm").error()).toBeUndefined();
    form.field("password").setValue("zzzz");
    expect(form.field("confirm").error()).toBe("Must match");
  });

  it("[FRM-63] a form-level validate may return a string (form problem), a map, or a list of issues", async () => {
    const asString = makeForm({ defaultValues: { a: "" }, validate: () => "Form is closed" });
    await asString.trigger();
    expect(asString.formErrors().map((i) => i.message)).toEqual(["Form is closed"]);

    const asList = makeForm({
      defaultValues: { rows: [{ n: 1 }] },
      validate: () => [
        { path: ["rows", 0, "n"], message: "bad n" },
        { path: "rows.0", message: "bad row", type: "row" },
      ],
    });
    await asList.trigger();
    expect(asList.errors()).toEqual({ "rows.0.n": "bad n", "rows.0": "bad row" });
    expect(asList.field("rows.0").errors()[0]?.type).toBe("row");
  });

  it("[FRM-64] a validator that throws becomes a problem on the field and the form keeps working", async () => {
    const form = makeForm({
      defaultValues: { a: "x" },
      validators: {
        a: () => {
          throw new Error("validator exploded");
        },
      },
    });
    await form.trigger();
    expect(form.field("a").error()).toBe("validator exploded");
    expect(form.field("a").errors()[0]?.type).toBe("validate");
  });

  it("[FRM-65] a validator that returns something that is not a problem fails loudly", async () => {
    const form = makeForm({
      defaultValues: { a: "x" },
      validators: { a: () => true as unknown as string },
    });
    await form.trigger();
    expect(form.field("a").error()).toMatch(/must return a message/);
  });
});

describe("async validation", () => {
  it("[FRM-70] only the latest answer counts: a slow answer to an older value is dropped", async () => {
    const pending: Array<{ value: string; gate: ReturnType<typeof deferred<string | undefined>> }> =
      [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: (value: string) => {
          const gate = deferred<string | undefined>();
          pending.push({ value, gate });
          return gate.promise;
        },
      },
    });
    const user = form.field("user");
    user.setValue("a");
    user.setValue("ab");
    expect(pending.map((p) => p.value)).toEqual(["a", "ab"]);
    expect(user.validating()).toBe(true);
    expect(form.isValidating()).toBe(true);
    pending[1]?.gate.resolve("ab is taken");
    await settle();
    expect(user.error()).toBe("ab is taken");
    expect(user.validating()).toBe(false);
    pending[0]?.gate.resolve("a is taken");
    await settle();
    expect(user.error()).toBe("ab is taken");
    expect(form.isValidating()).toBe(false);
  });

  it("[FRM-71] each new run aborts the previous signal; dispose aborts the last one", async () => {
    const signals: AbortSignal[] = [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: (_value: string, context) => {
          signals.push(context.signal);
          return new Promise<undefined>(() => undefined);
        },
      },
    });
    form.field("user").setValue("a");
    form.field("user").setValue("b");
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    form.dispose();
    expect(signals.map((s) => s.aborted)).toEqual([true, true]);
  });

  it("[FRM-72] unmounting during validation: the late answer is ignored and nothing is written", async () => {
    const gate = deferred<string | undefined>();
    const form = makeForm({
      defaultValues: { user: "x" },
      validators: { user: () => gate.promise },
    });
    const pending = form.trigger();
    expect(form.isValidating()).toBe(true);
    form.dispose();
    gate.resolve("too late");
    await settle();
    expect(form.field("user").error()).toBeUndefined();
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });

  it("[FRM-73] debounce: the validator starts after the quiet period; typing restarts it; blur runs it at once", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const form = makeForm({
      defaultValues: { user: "" },
      validateOn: "change",
      validators: {
        user: {
          debounceMs: 300,
          validate: (value: string) => {
            calls.push(value);
            return undefined;
          },
        },
      },
    });
    const user = form.field("user");
    user.setValue("a");
    vi.advanceTimersByTime(200);
    user.setValue("ab");
    vi.advanceTimersByTime(299);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["ab"]);
    user.setValue("abc");
    user.onBlur();
    expect(calls).toEqual(["ab", "abc"]);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["ab", "abc"]);
  });

  it("[FRM-74] a rejected async validator shows its message and ends the validating state", async () => {
    const form = makeForm({
      defaultValues: { user: "x" },
      validators: { user: () => Promise.reject(new Error("network down")) },
    });
    await form.trigger();
    expect(form.field("user").error()).toBe("network down");
    expect(form.field("user").validating()).toBe(false);
  });

  it("[FRM-75] submit waits for async validators and is blocked by their problems", async () => {
    const gate = deferred<string | undefined>();
    const onSubmit = vi.fn();
    const form = makeForm({
      defaultValues: { user: "taken" },
      validators: { user: () => gate.promise },
      onSubmit,
    });
    const submitting = form.handleSubmit();
    expect(form.isSubmitting()).toBe(true);
    gate.resolve("Already taken");
    expect(await submitting).toMatchObject({ ok: false, reason: "invalid" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.field("user").error()).toBe("Already taken");
  });

  it("[FRM-76] an async schema: the pass debounces while typing, shows nothing it should not, and applies the latest answer", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const base = customSchema(
      [{ path: ["name"], check: (v) => (v === "" ? "required" : undefined) }],
      {
        asynchronous: true,
      },
    );
    const schema = {
      "~standard": {
        ...base["~standard"],
        validate: (input: unknown) => {
          calls += 1;
          return base["~standard"].validate(input);
        },
      },
    };
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { name: "" } as Record<string, unknown>,
      validateOn: "change",
      debounceMs: 100,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    form.field("name").setValue("a");
    form.field("name").setValue("ab");
    form.field("name").setValue("");
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(form.field("name").error()).toBe("required");
  });
});

describe("pushed problems", () => {
  it("[FRM-80] trigger(paths) shows problems for those paths only and reports validity", async () => {
    const form = signupForm();
    expect(await form.trigger("email")).toBe(false);
    expect(form.errors()).toEqual({ email: "Email too short" });
    expect(await form.trigger(["email", "password"])).toBe(false);
    expect(Object.keys(form.errors()).sort()).toEqual(["email", "password"]);
    form.setValues({ email: "abc", password: "abcd" });
    expect(await form.trigger(["email", "password"])).toBe(true);
    expect(await form.trigger()).toBe(false);
    expect(form.field("tags.0.label").error()).toBe("Label too short");
  });

  it("[FRM-81] a revealed problem keeps following the field (clears when fixed) even in 'submit' mode", async () => {
    const form = signupForm({ validateOn: "submit", reValidateOn: "submit" });
    await form.trigger("email");
    expect(form.field("email").error()).toBe("Email too short");
    form.field("email").setValue("abcd");
    expect(form.field("email").error()).toBeUndefined();
  });

  it("[FRM-82] setError shows at once and is cleared by the next change of that field; clearError removes it", () => {
    const form = makeForm({ defaultValues: { email: "a@b", name: "x" } });
    form.field("email").setError("Already registered");
    expect(form.field("email").error()).toBe("Already registered");
    expect(form.isValid()).toBe(false);
    form.field("name").setValue("y");
    expect(form.field("email").error()).toBe("Already registered");
    form.field("email").setValue("c@d");
    expect(form.field("email").error()).toBeUndefined();
    expect(form.isValid()).toBe(true);
    form.setError("name", [{ message: "m1", type: "custom" }, "m2"]);
    expect(
      form
        .field("name")
        .errors()
        .map((i) => i.type),
    ).toEqual(["custom", "manual"]);
    form.field("name").clearError();
    expect(form.field("name").error()).toBeUndefined();
    form.setError("", "Whole form");
    expect(form.formErrors().map((i) => i.message)).toEqual(["Whole form"]);
    form.clearErrors();
    expect(form.formErrors()).toEqual([]);
  });

  it("[FRM-83] disabled fields are left out of validation and of the submitted data by default; excludeDisabled:false keeps them", async () => {
    const schema = z.object({ a: z.string().min(1, "a required"), b: z.string() });
    const seen: unknown[] = [];
    const excluded = makeForm({
      resolver: standardSchema(
        schema.partial({ a: true }).extend({ a: z.string().min(1, "a required").optional() }),
      ),
      defaultValues: { a: "", b: "b" },
      onSubmit: (data) => void seen.push(data),
    });
    excluded.field("a").setDisabled(true);
    expect(excluded.field("a").disabled()).toBe(true);
    expect(await excluded.handleSubmit()).toMatchObject({ ok: true });
    expect(seen).toEqual([{ b: "b" }]);

    const included = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { a: "", b: "b" },
      excludeDisabled: false,
    });
    included.field("a").setDisabled(true);
    expect(await included.handleSubmit()).toMatchObject({ ok: false, reason: "invalid" });
    expect(included.field("a").error()).toBe("a required");
  });
});
