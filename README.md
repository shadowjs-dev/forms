<p align="center"><img src="https://raw.githubusercontent.com/shadowjs-dev/forms/main/.github/banner.png" alt="ShadowJS" width="100%"></p>

# @shadow-js/forms

[![npm](https://img.shields.io/npm/v/@shadow-js/forms.svg)](https://www.npmjs.com/package/@shadow-js/forms)
[![CI](https://github.com/shadowjs-dev/forms/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowjs-dev/forms/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/shadowjs-dev/forms/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

Forms for ShadowJS 1.0.0: fine-grained values, [Standard Schema](https://standardschema.dev)
validation (Zod, Valibot, ArkType, Effect Schema, anything with `~standard.validate`; the examples
and tests use Zod and a hand-written schema), arrays with stable rows, async validation that cancels and cannot race, server errors, a multi-step helper and
headless components. It replaces `react-hook-form` plus a resolver, and it is built on public
`@shadow-js/core` and `@shadow-js/web` APIs only.

## React Hook Form names

`useWatch`, `useFormState`, `useFieldArray`, `FormProvider`, `Controller`, `getFieldState`, `setFocus`,
`unregister`, `reset(values, { keepValues, keepDefaultValues, keepErrors, keepTouched, ... })`,
`criteriaMode`, `reValidateMode`, `shouldUnregister`, the `values` prop (a reactive reset), asynchronous
`defaultValues` (`isLoading()`, `loadError()`) and the `formState` getters (each read subscribes to that
part only).

## Install

```bash
npm install @shadow-js/forms
```

A component runs once. Nothing here re-renders: `form.field("email").value()` read in JSX or an
effect subscribes to that one value, so a keystroke updates the readers of the field that changed
and nothing else (a 600-field form is tested for exactly that).

Submission and invalid-submission callbacks run untracked, including when synchronous validation
finishes inside an effect. Signal reads in those callbacks do not subscribe the submitting caller.
Thrown callback errors become an error result and `submitError()`, including configured `onInvalid`
handlers; `handleSubmit()` resolves with that outcome.

## Opt-in features

`useForm` checks values with a `validate` rule or a `resolver`, shows problems, submits and resets. Four
capabilities are modules of their own: pass the ones you use in `useForm({ features: [...] })`, and a form
carries no code for the rest.

| Feature | Import from | Adds | Without it |
|---|---|---|---|
| `fieldArrays` | `@shadow-js/forms/arrays` | `form.fields(path)`, `useFieldArray`, `<FieldArray>` | `form.fields` does not exist (a type error); the hook and the component throw, naming the feature |
| `asyncValidation` | `@shadow-js/forms/async` | promises from a resolver, a `validate` rule or a field validator; `debounceMs`; `isValidating()` | a promise becomes a problem that names the feature; `debounceMs` throws when the form is created |
| `dates` | `@shadow-js/forms/dates` | the date family of native controls: `date`, `time`, `month`, `week`, `datetime-local` | binding one of those controls throws a `TypeError` that names the feature |
| `submitErrors` | `@shadow-js/forms/submit-errors` | problems thrown by `onSubmit` (`submitWith`, `FormSubmitError`, a `ValidationError`) shown on their fields; `initialErrors` | a thrown error is `submitError()` only; `initialErrors` throws when the form is created |

The resolver for a Standard Schema is `standardSchema(schema)` from `@shadow-js/forms/standard-schema`
(`useForm({ resolver: standardSchema(schema) })`); the `schema` option is refused with a `TypeError` that
names it.

## Full preset

`@shadow-js/forms/full` exports `useForm` and `full`, the four features as one list, so a form that uses
all of them imports from one place. A form that needs fewer keeps its own `features` list.

```ts typecheck title="full-preset.ts"
import { full, useForm } from "@shadow-js/forms/full";

declare function isTaken(name: string): Promise<boolean>;

export function playlistForm() {
  const form = useForm({ features: full, defaultValues: { name: "", songs: [{ title: "" }] } });
  form.field("name", {
    validate: {
      debounceMs: 300,
      validate: async (name) => ((await isTaken(name)) ? "Name taken" : undefined),
    },
  });
  const addSong = (): void => form.fields("songs").append({ title: "" });
  return { form, addSong };
}
```

## Quick start

```tsx run mount="Signup" title="signup.tsx"
import { Field, Form, useForm } from "@shadow-js/forms";
import { standardSchema } from "@shadow-js/forms/standard-schema";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter an email"),
  age: z.coerce.number().min(18, "Adults only"),
  tags: z.array(z.object({ label: z.string().min(2) })),
});

export function Signup() {
  const form = useForm({
    resolver: standardSchema(schema), // the form holds z.input<typeof schema>; onSubmit receives z.output<typeof schema>
    defaultValues: { email: "", age: "", tags: [] },
    onSubmit: async (data) => {
      await save(data); // data.age is a number here
    },
  });
  const email = form.field("email"); // FieldApi<string>: the path is checked against the values
  return (
    <Form form={form} class="space-y-4">
      <input type="email" {...email.props()} />
      <p id={email.errorId}>{email.error()}</p>
      <Field form={form} name="age">
        {(age) => <input inputmode="numeric" {...age.props()} />}
      </Field>
      <button type="submit" disabled={form.isSubmitting()}>
        Create account
      </button>
    </Form>
  );
}

declare function save(data: z.output<typeof schema>): Promise<void>;
```

## When problems show

Validation always knows the truth (`form.isValid()` follows the schema and the `validate` rule from
the first render, so a "Save" button can follow it; field validators join after the first edit, blur,
`trigger()` or submit), but a field shows a problem only when you said it should.

| `validateOn` (before a submit) | The first problem appears |
|---|---|
| `"touched"` (default) | when the field loses focus, then live on every input |
| `"change"` | on every input event |
| `"blur"` | when the field loses focus; typing does not update it until the next blur |
| `"submit"` | when the form is submitted (or `trigger()` is called) |

`validateOn` also takes a list (`["blur", "change"]`). `reValidateOn` (`"change"` default, `"blur"`,
`"submit"`) decides how problems update after the first submit. `mode` accepts React Hook Form's
names (`onSubmit`, `onBlur`, `onChange`, `onTouched`, `all`); `validateOn` wins when both are given.
A problem that `trigger()` revealed before any submit keeps following its field, so fixing it clears
it. After a submit, `reValidateOn` decides: `"change"` follows typing, `"blur"` waits for the next
blur, `"submit"` keeps the problem until the next submit. A rule about other fields (`confirm` must
equal `password`) updates a field the user has already met.

## API

### `useForm(options)`

| Option | Meaning |
|---|---|
| `defaultValues` | Starting values (deeply partial). Copied: your object is never mutated. Also the baseline of `dirty` and `reset()`. |
| `resolver` | `standardSchema(schema)` for any Standard Schema (`@shadow-js/forms/standard-schema`). `onSubmit` receives its **output**. A promise needs `asyncValidation`. |
| `validate(values, { signal, trigger })` | Cross-field rule over all values. Returns a message (form-level), `{ path: message }`, or a list of `{ path, message }`. Sync; a promise needs `asyncValidation`. |
| `validators` | `{ "email": fn, "lines.*.sku": fn \| { validate, debounceMs } }`. `*` matches one step. |
| `validateOn`, `reValidateOn`, `mode` | When problems appear (above). |
| `debounceMs` | Quiet period before an async resolver / `validate` re-runs after typing. Needs `asyncValidation`. |
| `onSubmit(output, ctx)` | `ctx` has `signal`, `form`, `input` (the validated values) and `event`. Throwing fails the submit; the problems it throws are shown on fields with `submitErrors`. |
| `features` | The opt-in features (`[fieldArrays, asyncValidation, submitErrors]`, see above). |
| `onInvalid(issues)` | Called when validation stops a submit. |
| `resetOnSuccess` | `true` restores the defaults; `"values"` makes the submitted values the new baseline (use it with the unsaved-changes guard). |
| `disabled` | `boolean` or an accessor. A disabled form does not submit and its controls get `disabled`. |
| `excludeDisabled` | Default `true`: fields marked disabled are not validated and are left out of the data. |
| `emptyValue` | `"string"` (default), `"undefined"` or `"null"`: what an empty text control stores. |
| `initialErrors` | Problems to show from the start (a map or Standard Schema issues), for a no-JavaScript post answered with errors. Needs `submitErrors`. |
| `shouldFocusError` | Default `true`. |
| `id` | Prefix of generated ids. Default `useId()` inside a component; outside one forms are numbered in creation order (`form`, `form-2`...), so two shared forms never collide. Name a module-level form with `id` for good. |

### The form

Reads are accessors; everything reactive is read by calling it.

| Read | |
|---|---|
| `values` | Deep read-only fine-grained store: `form.values.user.name` subscribes to that property. |
| `getValues(path?)` | A plain copy, not reactive. `watch(path?)` returns an accessor. |
| `errors()`, `issues()`, `formErrors()` | Shown problems by path / with paths / those with no field. |
| `isValid()`, `isDirty()`, `isTouched()`, `isValidating()` | Whole-form state. `touchedFields()`, `dirtyFields()` list paths. |
| `isSubmitting()`, `isSubmitted()`, `isSubmitSuccessful()`, `submitCount()`, `submitError()` | Submit state. `submitError()` is `{ message, cause }`. |

| Action | |
|---|---|
| `setValue(path, value \| updater, { validate?, touch? })`, `setValues(partial)` | Objects merge, arrays and leaves replace. A refused path writes nothing. |
| `reset(values?)`, `resetField(path)` | Back to the defaults (or adopt new ones). A reset also cancels a submit in flight. |
| `trigger(paths?)` | Validate now and show the problems (paths include what is below them). Resolves to validity. |
| `setError(path, issue \| issues)`, `clearErrors(paths?)` | `""` is the form as a whole. A hand-set problem goes away when its field changes. |
| `handleSubmit(event?)` | Prevents the default, marks every field touched, validates everything (awaiting async rules), focuses the first invalid control in document order, calls `onSubmit` with the parsed output. Never throws: it resolves to `{ ok: true, data, result }` or `{ ok: false, reason: "invalid" \| "error" \| "busy" \| "disabled" \| "canceled" }`. |
| `handleSubmitWith(onValid, onInvalid?)` | The same with handlers of your own (several submit buttons). |
| `props()` | Spreadable attributes for a `<form>`: `id`, `noValidate`, `aria-busy`, `onSubmit`. |
| `focus(path)`, `focusFirstError()`, `dispose()` | `dispose` runs on its own when the owner is disposed. |

### The field handle (stable contract for UI kits)

`form.field("user.emails.0.address")` returns a `FieldApi<string>`; the same path returns the same
handle. Paths are typed from the values (`Path<T>`, `PathValue<T, P>`); `fieldAt(path)` takes any
string. This is the shape a wrapper such as the shadcn `FormField` consumes and it will not change:

| Member | |
|---|---|
| `value()` | Current value (reactive). |
| `error()`, `errors()`, `invalid()` | The message to show / all issues (`{ message, type, params? }`) / whether one shows. |
| `touched()`, `dirty()`, `validating()`, `disabled()`, `focused()` | Reactive flags. `dirty` compares with the default (a row with its own). |
| `setValue(v \| fn, opts?)`, `setError(...)`, `clearError()`, `setTouched()`, `setDisabled()` | Writers. |
| `onInput(e)`, `onChange(e)`, `onBlur(e?)`, `onFocus(e?)` | Event handlers: read the control, store, validate. |
| `props(options?)`, `ref(el)`, `optionProps(value)` | Attribute bags and registration (below). |
| `id`, `errorId`, `path` | For `for`, `aria-describedby`, `name`. |
| `trigger()`, `reset()`, `focus()`, `elements()`, `field(subpath)` | Actions and a field below this one. |

A custom control (a Select from `@shadow-js/primitives`, a date picker) calls `setValue(v)`,
`onBlur()` and reads `value()` / `error()`; no events are needed.

### Binding native controls

`field.props()` (or `bind(field, ...)`) returns a bag to spread. The value is a *property*, an IME
composition is never interrupted, a control follows the form even after the user typed (a
handler that writes the old value back leaves the control showing it), and a control that is not
on the page any more is forgotten.

| Control | Call | Stores |
|---|---|---|
| text, email, password, search... | `field.props()` | string (`emptyValue` policy; `{ trim: true }`) |
| `<textarea>` | `field.props({ kind: "textarea" })` | string; also sets `children`, so server markup has the text |
| number | `field.props({ kind: "number" })` | number; empty is `undefined` (`empty: "null"`); text that is not a number is `undefined` (`invalid: "nan"` keeps `NaN`), and the control keeps what the user typed |
| checkbox | `{ kind: "checkbox" }` | boolean; with `value: "a"`, toggles `"a"` in an array |
| radio group | `{ kind: "radio", value: "pro" }` on each radio | the chosen value |
| select | `{ kind: "select" }` / `{ kind: "select", multiple: true }` | string / string[]. Mark options with `<option {...field.optionProps("a")}>` so server markup shows the choice |
| file | `{ kind: "file" }` / `{ kind: "file", multiple: true }` | `File \| undefined` / `File[]` (a cleared field clears the input) |
| date | `{ kind: "date", type?: "date" \| "datetime-local" \| "time" \| "month" \| "week", as?: "string" \| "date" \| "number" }` | text, `Date` or epoch ms |

Put your own attributes after the spread (`<input {...f.props({ kind: "number" })} type="range" />`).
`name` is the field path, so a native post reads `user.emails.0.address`. A radio gets one id per
radio; the members of a checkbox group share the field's id, so wrap each in a `<label>` or set `id`
after the spread. A `week` input can be stored as text only.

### Arrays

Field arrays need the `fieldArrays` feature: `useForm({ features: [fieldArrays], ... })`.

`form.fields("user.emails")` returns a `FieldArrayApi`: `append`, `prepend`, `insert`, `remove(i | [i])`,
`move`, `swap`, `update`, `replace`, `clear`, `keys()`, `length()`, `row(key)`, `at(i)` and
`each(render)`. Every row has a stable key (`r1`, `r2`...): errors, touched flags, controls and
focus stay with the **row** while rows around it are added, removed or moved. Removing a row
deletes exactly its state. A row is addressed by key (`RowApi`: `row.field("address")`,
`row.index()`, `row.remove()`, `row.isNew()`, `row.dirty()`), and `form.field("emails.0.address")`
resolves through the same rows.

```tsx run mount="Emails" title="emails.tsx"
import { FieldArray, Form, useForm } from "@shadow-js/forms";
import { fieldArrays } from "@shadow-js/forms/arrays";

export function Emails() {
  const form = useForm({
    features: [fieldArrays],
    defaultValues: { emails: [{ address: "" }] },
  });
  return (
    <Form form={form}>
      <FieldArray form={form} name="emails" fallback={<p>No emails yet.</p>}>
        {(row) => (
          <div>
            <input {...row.field("address").props()} />
            <button type="button" onClick={() => row.remove()}>Remove</button>
          </div>
        )}
      </FieldArray>
      <button type="button" onClick={() => form.fields("emails").append({ address: "" })}>
        Add
      </button>
    </Form>
  );
}
```

```tsx test title="emails.test.tsx"
import { cleanup, fireEvent, render, userEvent } from "@shadow-js/testing/dom";
import { afterEach, expect, it } from "vitest";
import { Emails } from "./emails";

afterEach(cleanup);

it("a row keeps its element while rows around it are added and removed", () => {
  const view = render(() => <Emails />);
  const [first] = view.container.querySelectorAll("input");
  userEvent.type(first as HTMLInputElement, "ada@example.com");

  fireEvent.click(view.getByRole("button", { name: "Add" }));
  expect(view.container.querySelectorAll("input")).toHaveLength(2);
  expect(view.container.querySelector("input")).toBe(first); // the same element, still holding the text

  fireEvent.click(view.getAllByRole("button", { name: "Remove" })[1] as HTMLElement);
  expect(view.container.querySelectorAll("input")).toHaveLength(1);
  expect((first as HTMLInputElement).value).toBe("ada@example.com");
});
```

Moving or removing a row costs the rows whose position changes, not the whole list. Focus survives
a reorder even where the browser lacks `Node.moveBefore`. Edits made with the array's own value
(`setValue("emails", [...])`, `setValues`, `reset`) give the rows new keys.

### Validation

- **Schema.** `resolver: standardSchema(z.object(...))` (or Valibot, ArkType...). Issue paths become field paths
  (`["emails", 0, "address"]` → `emails.0.address`); issues with no path go to `formErrors()`. A
  schema that transforms is typed both ways: fields hold the input, `onSubmit` gets the output.
- **Field validators.** `validators: { "lines.*.sku": fn }` or `form.field(path, { validate })`
  (removed when the component's owner is disposed). A validator returns `undefined` (valid), a
  string, `{ message, type?, params? }`, or a list. The empty string is valid.
- **Async.** Needs `features: [asyncValidation]`. Return a promise. Every new run aborts the previous `context.signal`, a late answer to
  an older value is dropped, `field.validating()` / `form.isValidating()` report it, and
  `{ validate, debounceMs }` waits for a quiet period while typing (blur, `trigger()` and submit run
  at once). A rejection or throw becomes a problem on the field instead of breaking the form.
- **Cross-field.** `validate(values)` (above), or a rule in the schema (`.refine`).
- **Disabled fields.** `field.setDisabled(true)` leaves the field out of validation and of the
  submitted data (`excludeDisabled: false` keeps it). The schema then sees the field as missing, so a
  field that can be disabled must be optional in the schema; a required one makes `isValid()` false
  and stops the submit with `{ ok: false, reason: "invalid", error }` whose message names the field
  (also `form.submitError()`); enabling the field makes the form valid again.
- **The first pass** (creation, `reset`) runs only the schema and `validate`: field validators may
  call a server, so they wait for an edit, a blur, `trigger()` or a submit.

### Server errors and progressive enhancement

```ts test title="server.test.ts"
import { applyServerErrors, FormSubmitError, submitWith, useForm } from "@shadow-js/forms";
import { parseFormData } from "@shadow-js/forms/server";
import { standardSchema } from "@shadow-js/forms/standard-schema";
import { submitErrors } from "@shadow-js/forms/submit-errors";
import { renderHook } from "@shadow-js/testing";
import { expect, it } from "vitest";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

// A stand-in for a server function: it rejects the way the browser stub of a Dusk server function
// does, with an error whose `data.issues` lists the problems.
async function createUser(input: { email: string }): Promise<{ id: string }> {
  if (input.email === "ada@example.com") {
    throw Object.assign(new Error("Invalid input"), {
      status: 400,
      data: { issues: [{ message: "Already registered", path: ["email"] }] },
    });
  }
  return { id: "u1" };
}

it("1. a server function as the submit handler: thrown issues land on the fields", async () => {
  const { result } = renderHook(() =>
    useForm({
      id: "signup",
      features: [submitErrors],
      resolver: standardSchema(schema),
      defaultValues: { email: "ada@example.com" },
      onSubmit: submitWith(createUser),
    }),
  );
  const form = result.current;
  expect(await form.handleSubmit()).toMatchObject({ ok: false, reason: "error" });
  expect(form.field("email").error()).toBe("Already registered");

  form.setValue("email", "grace@example.com");
  expect(await form.handleSubmit()).toMatchObject({ ok: true, result: { id: "u1" } });
});

it("2. map errors yourself, or throw your own", async () => {
  const { result } = renderHook(() => useForm({ id: "manual", defaultValues: { email: "ada@example.com" } }));
  const form = result.current;
  try {
    await createUser({ email: form.getValues("email") });
  } catch (error) {
    expect(applyServerErrors(form, error).applied).toBe(true);
  }
  expect(form.errors()).toEqual({ email: "Already registered" });

  const own = renderHook(() =>
    useForm({
      features: [submitErrors],
      defaultValues: { email: "" },
      onSubmit: () => {
        throw new FormSubmitError("Could not save", { fieldErrors: { email: "Taken" } });
      },
    }),
  ).result.current;
  await own.handleSubmit();
  expect(own.field("email").error()).toBe("Taken");
  expect(own.submitError()?.message).toBe("Could not save");
});

it("3. a native post (JavaScript off): the same schema validates the same typed values", async () => {
  const body = new URLSearchParams({ email: "nope" });
  const request = new Request("http://localhost/signup", { method: "POST", body });
  const post = await parseFormData(schema, await request.formData(), { defaults: { email: "" } });
  if (post.success) throw new Error("expected a failure");
  expect(post.errors).toEqual({ email: [{ message: "Invalid email address" }] });
  expect(post.values).toEqual({ email: "nope" }); // render the page again with initialErrors: post.errors
});
```

`submitWith` and a thrown `FormSubmitError` show their problems on the fields with the `submitErrors` feature (above); `applyServerErrors(form, source, { focus? })` needs no feature and accepts Standard Schema issues, a `ValidationError`
from `@shadow-js/dusk` (also as the `HttpError` a server function throws on the client, which
carries `data.issues`), `{ fieldErrors }`, or a map of path to message(s); it returns which paths
received a problem. A server problem goes away when its field changes and every submit starts clean.
`@shadow-js/forms/server` (`formDataToValues`, `parseFormData`, `extractIssues`, `issuesToErrors`) has
no reactive imports, so it is safe in a server function. `formDataToValues` reads names like `email`,
`user.emails.0.address` or `lines[0].sku`; the defaults you pass guide coercion (numbers, booleans
that are absent when unchecked, dates, lists). Reserved names (`__proto__`...), malformed names and
sparse-array bombs are skipped and reported through `onSkip`, never written. Render the page again
with `initialErrors: result.errors` and `defaultValues: result.values`.

Server rendering works: ids come from the hydration scope, `props()` renders `value`, `checked`,
`aria-invalid` and `aria-describedby` into the markup, and hydration keeps the server's elements
(tested, including initial errors). Use `kind: "textarea"` and `optionProps` where HTML has no
`value` attribute.

### Multi-step forms

```ts test title="wizard.test.ts"
import { useForm, useWizard } from "@shadow-js/forms";
import { standardSchema } from "@shadow-js/forms/standard-schema";
import { renderHook } from "@shadow-js/testing";
import { expect, it } from "vitest";
import { z } from "zod";

it("next validates the current step only", async () => {
  const { result } = renderHook(() => {
    const form = useForm({
      resolver: standardSchema(z.object({ email: z.string().email(), profile: z.object({ first: z.string().min(1) }) })),
      defaultValues: { email: "", profile: { first: "" } },
    });
    const wizard = useWizard(form, {
      steps: [
        { id: "account", fields: ["email"] },
        { id: "profile", fields: ["profile"] }, // a container covers everything below it
      ],
    });
    return { form, wizard };
  });
  const { form, wizard } = result.current;

  expect(await wizard.next()).toBe(false);
  expect(Object.keys(form.errors())).toEqual(["email"]); // the profile step stays quiet
  form.setValue("email", "ada@example.com");
  expect(await wizard.next()).toBe(true);
  expect(wizard.current().id).toBe("profile");
  wizard.back(); // never validates
  expect(wizard.isFirst()).toBe(true);
});
```

`next()` validates the current step only (and focuses the first problem), `back()` never validates,
`goTo(n)` is free backwards and needs every step before `n` to be clean going forward.

### Unsaved changes

```ts test title="guard.test.ts"
import { useForm, useUnsavedChangesGuard } from "@shadow-js/forms";
import { renderHook } from "@shadow-js/testing";
import { expect, it } from "vitest";

it("blocks while the form differs from its defaults", async () => {
  const { result } = renderHook(() => {
    const form = useForm({ defaultValues: { title: "" }, resetOnSuccess: "values", onSubmit: () => undefined });
    // with the router: useBlocker(guard.blocker)
    return { form, guard: useUnsavedChangesGuard(form, { beforeUnload: false }) };
  });
  const { form, guard } = result.current;
  expect(guard.blocker()).toBe(false);
  form.setValue("title", "Draft");
  expect(guard.shouldBlock()).toBe(true);
  await form.handleSubmit(); // a save adopts the submitted values as the baseline
  expect(guard.blocker()).toBe(false);
});
```

`blocker(transition?)` matches `useBlocker`'s predicate and does not subscribe; `shouldBlock()` is
reactive for a banner. The form counts as unsaved while it differs from its defaults and no submit
is running.

### Components

Headless; only `<Form>` renders an element (through `Dynamic`, so the same code serves the
browser and the server). `<Form form={form}>` is a `<form>` with `novalidate` that submits through
`form.handleSubmit` (your own `onSubmit` runs first and can `preventDefault()` to veto) and
provides the form: `<Field name>` / `<FieldArray name>` use it when `form` is omitted (TypeScript
cannot see which form that is, so `name` is any string and the value is `unknown`; pass `form` for
exact types, or the values type, `<Field<Values> name="email">`, to check the path), and
`useFormContext<Values>()` reads it. `<Field>` calls its render function once (a signal as `name` renders the
new field); `<FieldArray>` renders keyed rows with an optional `fallback`.

### Paths

`name`, `address.city`, `user.emails.0.address`; `lines[2].sku` is accepted and normalized to
`lines.2.sku`. A key is any text without `.`, `[`, `]` or control characters; a step of digits without a
leading zero is an array index (`"007"` is a key). `__proto__`, `constructor` and `prototype` are refused everywhere
(`FormPathError`). A path through a missing parent creates the parents (an array when the next
step is an index); writing past the end of an array fills the gap with `undefined` (at most 1000
slots) so arrays stay dense. A refused write changes nothing.

## Coming from React Hook Form

| React Hook Form | `@shadow-js/forms` |
|---|---|
| `useForm({ resolver: zodResolver(schema) })` | `useForm({ resolver: standardSchema(schema) })` (any Standard Schema; typed in and out) |
| `register("email")` | `<input {...form.field("email").props()} />` |
| `Controller` / `useController` | `form.field(path)`: `value()`, `setValue`, `onBlur`, `error()` |
| `formState.errors.email?.message` | `form.field("email").error()` |
| `formState.isSubmitting`, `isDirty`, `isValid` | `form.isSubmitting()`, `isDirty()`, `isValid()` |
| `watch("email")` | `form.watch("email")` (an accessor) or read `field.value()` |
| `useFieldArray` (`fields`, `append`, `remove`) | `form.fields("items")` (`keys`, `append`, `remove`, `each`), with `features: [fieldArrays]` |
| `handleSubmit(onValid)` | `form.handleSubmit` (options.`onSubmit`) or `handleSubmitWith(onValid)` |
| `setError("root.server")` | `form.setError("", ...)` / `applyServerErrors(form, error)` |
| `mode: "onTouched"` | the default; `mode` is accepted |
| `reset(values)` | `form.reset(values)` |

Differences worth knowing: a component runs once, so there is no re-render and nothing to
memoize; `validateOn` defaults to `"touched"`, not React Hook Form's `onSubmit`; field state lives
with the row, not the index.

## Limits

- IME composition, real focus loss on DOM moves and the browser's `type="number"` sanitizing are
  covered with simulated events in happy-dom; they have not been observed in a real browser.
- Checkbox groups and selects store strings (the DOM's values); convert with the schema
  (`z.coerce.number()`).
- `dirty` for a whole array compares by position and length; a row compares with its own default (a row added later with the default at its position is clean). `dirtyFields()` is empty exactly when `isDirty()` is false.
- Field validators are not part of the first pass (they may call a server), so `isValid()` ignores
  them on a fresh form until an edit, a blur, `trigger()` or a submit; `await form.trigger()` makes
  it exact. A schema or `validate` rule that answers asynchronously makes `isValid()` `false` until
  its first answer.
- Drafts (persisting values in storage) are not part of this package.
- Valibot and ArkType implement Standard Schema and are expected to work; the repository's tests run
  Zod and a hand-written schema, and Valibot / ArkType suites that skip themselves when those
  packages are not installed (see the devDependencies note in `package.json`).

## Learn more

- `test/` is the specification: every behavior above has a test with an invariant id (`[FRM-nn]`).

## Production error codes

A production build keeps a short code instead of the development explanation, so message text never reaches user bundles. Search this table for the code. In the explanation, `…` stands for a value the development message names. A code followed by a word names the option, feature or member at fault.

| Code | Development explanation |
| --- | --- |
| `FORMS_CLASH` | "…" clashes with another name |
| `FORMS_ENTRIES` | more than … form entries |
| `FORMS_INDEX` | cannot … … in "…" (valid: 0 to …) |
| `FORMS_KEY_1` | "…" cannot be a key (no . [ or ]) |
| `FORMS_KEY_2` | control characters are not allowed in … |
| `FORMS_KEY_3` | empty key in … |
| `FORMS_KEY_4` | "…" is a reserved key in data / "…" is a reserved key |
| `FORMS_NEED_1` | fields() needs features: [fieldArrays] (@shadow-js/forms/arrays) |
| `FORMS_NEED_2` | `debounceMs` or an async check needs `features: [asyncValidation]` (`@shadow-js/forms/async`). |
| `FORMS_NEED_3` | A date, time, month, week or datetime-local control needs `features: [dates]` (`@shadow-js/forms/dates`). |
| `FORMS_NEED_4` | `initialErrors` needs `features: [submitErrors]` (`@shadow-js/forms/submit-errors`). |
| `FORMS_NOFORM` | this must be used inside a <Form> |
| `FORMS_NOT_1` | "…" is not an array |
| `FORMS_NOT_2` | standardSchema() needs a Standard Schema (an object with `~standard.validate`) |
| `FORMS_PATH_1` | a path must be a non-empty string / cannot format an empty path |
| `FORMS_PATH_2` | index … is more than … past the end of … |
| `FORMS_PATH_3` | … is not an array index |
| `FORMS_PATH_4` | "…" is not an array index in … |
| `FORMS_PATH_5` | cannot write the root |
| `FORMS_PATH_6` | … is not an object or array |
| `FORMS_PATH_7` | … in "…" |
| `FORMS_ROW_1` | "…" has no row at … |
| `FORMS_ROW_2` | "…" has no row "…" |
| `FORMS_SCHEMA` | `schema` is now `resolver: standardSchema(schema)` (@shadow-js/forms/standard-schema) |
| `FORMS_VALIDATOR` | a validator must return a message, an issue object, a list of them, or nothing |
| `FORMS_WEEK` | a "week" input can only be stored as a string |
| `FORMS_WIZARD_1` | a wizard has no step … |
| `FORMS_WIZARD_2` | a wizard needs at least one step |
| `FORMS_DISABLED` | The schema requires fields that are disabled and left out of the data (the code is followed by the fields). Make the field optional in the schema, enable it, or pass `excludeDisabled: false`. |

## Dependencies

- Runtime: none.
- Peers: `@shadow-js/core` and `@shadow-js/web` `^1.0.0`: reactive state and the renderer the field components use.

## Types

- Names from the root: `FieldApi`, `FieldArrayApi`, `FormSubmitError`.
- Type tests in `test-types/` run with `npm run typecheck`.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: current evergreen releases.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

## Using, changing and contributing

- **Use the package** (a person or a coding agent that builds with it): this README, and [SKILL.md](SKILL.md), the short page an agent reads first.
- **Change the package** (fix a bug, add a feature): [AGENTS.md](AGENTS.md) says how the repository is laid out, how to implement and test a change, and how a pull request is reviewed. It is written for people and coding agents alike.
- **Take part**: [CONTRIBUTING.md](CONTRIBUTING.md) is the short guide; [SECURITY.md](SECURITY.md) is for vulnerabilities.
