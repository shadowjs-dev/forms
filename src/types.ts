/**
 * Public types of `@shadow-js/forms`: paths, issues, validators, options and the handles `useForm`
 * returns.
 * @packageDocumentation
 */
import type { Accessor, Store } from "@shadow-js/core";
import type { FeatureHost } from "./internal/feature-host";
import type { Segment } from "./path";

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

/** Values that are leaves in a form: they have no paths below them. */
type Leaf =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | Blob
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | ((...args: never[]) => unknown);

/** Depth budget: keeps the union finite and the compiler fast. */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8];

type PathsOf<T, D extends number> = [D] extends [never]
  ? never
  : T extends Leaf
    ? never
    : T extends readonly (infer U)[]
      ? `${number}` | `${number}.${PathsOf<NonNullable<U>, Prev[D]>}`
      : {
          [K in keyof T & string]-?: K | `${K}.${PathsOf<NonNullable<T[K]>, Prev[D]>}`;
        }[keyof T & string];

/**
 * Every valid field path of `T`, as a union of string literals: `"email"`, `"address.city"`,
 * `"user.emails.0.address"` (array steps are `${number}`). Strings, numbers, dates, files, maps,
 * sets and functions are leaves with no paths below them. Nesting is limited to 8 levels; deeper
 * paths are left out of the union.
 *
 * @example
 * ```ts
 * import type { Path } from "@shadow-js/forms";
 *
 * interface Signup {
 *   user: { name: string; emails: { address: string }[] };
 * }
 *
 * // "user" | "user.name" | "user.emails" | `user.emails.${number}` | `user.emails.${number}.address`
 * const paths: Path<Signup>[] = ["user.name", "user.emails", "user.emails.0.address"];
 * console.log(paths);
 * ```
 * @see {@link PathValue}
 * @since 1.0.0
 */
export type Path<T> = PathsOf<T, 8>;

type Step<T, K extends string> = [T] extends [never]
  ? never
  : T extends null | undefined
    ? undefined
    : T extends readonly (infer U)[]
      ? K extends `${number}`
        ? U
        : never
      : T extends object
        ? K extends keyof T
          ? T[K]
          : K extends `${infer N extends number}`
            ? N extends keyof T
              ? T[N]
              : never
            : never
        : never;

/**
 * The type of the value at path `P` of `T`. A step through an optional value adds `undefined`;
 * a path that does not exist gives `never`.
 *
 * @example
 * ```ts
 * import type { PathValue } from "@shadow-js/forms";
 *
 * interface Signup {
 *   user: { emails: { address: string }[] };
 * }
 *
 * const address: PathValue<Signup, "user.emails.0.address"> = "ada@example.com"; // string
 * console.log(address);
 * ```
 * @see {@link Path}
 * @since 1.0.0
 */
export type PathValue<T, P extends string> = P extends `${infer H}.${infer R}`
  ? PathValue<Step<T, H>, R>
  : Step<T, P>;

/**
 * The paths of `T` whose value is an array (or an optional array): the paths `form.fields`,
 * `useFieldArray` and `<FieldArray>` accept.
 *
 * @example
 * ```ts
 * import type { ArrayPath } from "@shadow-js/forms";
 *
 * interface Order {
 *   note: string;
 *   lines: { sku: string; tags: string[] }[];
 * }
 *
 * // "lines" | `lines.${number}.tags`
 * const lists: ArrayPath<Order>[] = ["lines", "lines.0.tags"];
 * console.log(lists);
 * ```
 * @see {@link ArrayItem}
 * @since 1.0.0
 */
export type ArrayPath<T> =
  Path<T> extends infer P
    ? P extends string
      ? NonNullable<PathValue<T, P>> extends readonly unknown[]
        ? P
        : never
      : never
    : never;

/**
 * The item type of the array at path `P`, or `never` when the value there is not an array.
 *
 * @example
 * ```ts
 * import type { ArrayItem } from "@shadow-js/forms";
 *
 * interface Order {
 *   lines: { sku: string; qty: number }[];
 * }
 *
 * const line: ArrayItem<Order, "lines"> = { sku: "A-1", qty: 2 };
 * console.log(line);
 * ```
 * @see {@link ArrayPath}
 * @since 1.0.0
 */
export type ArrayItem<T, P extends string> =
  NonNullable<PathValue<T, P>> extends readonly (infer I)[] ? I : never;

/**
 * `T` with every property optional at every depth, array items included. Leaves (strings, dates,
 * files...) stay as they are. Default values may leave anything out.
 *
 * @example
 * ```ts
 * import type { DeepPartial } from "@shadow-js/forms";
 *
 * interface Order {
 *   customer: { name: string; email: string };
 *   lines: { sku: string; qty: number }[];
 * }
 *
 * const draft: DeepPartial<Order> = { customer: { name: "Ada" }, lines: [{ qty: 1 }] };
 * console.log(draft);
 * ```
 * @since 1.0.0
 */
export type DeepPartial<T> = unknown extends T
  ? T
  : T extends Leaf
    ? T
    : T extends readonly (infer U)[]
      ? DeepPartial<U>[]
      : { [K in keyof T]?: DeepPartial<T[K]> | undefined };

/**
 * What `defaultValues` (and `reset`, `setValues`) accept for a form of `T`: a
 * {@link DeepPartial} of the values.
 *
 * @example
 * ```ts
 * import { type DefaultValues, useForm } from "@shadow-js/forms";
 *
 * interface Profile {
 *   name: string;
 *   address: { city: string; zip: string };
 * }
 *
 * const defaults: DefaultValues<Profile> = { name: "", address: { city: "Berlin" } };
 * const form = useForm<Profile>({ id: "profile", defaultValues: defaults });
 * console.log(form.getValues("address.city")); // "Berlin"
 * ```
 * @since 1.0.0
 */
export type DefaultValues<T> = DeepPartial<T>;

// ---------------------------------------------------------------------------------------------
// Issues and validators
// ---------------------------------------------------------------------------------------------

/**
 * One validation problem as a field reports it: what `field.errors()` and `form.formErrors()`
 * return.
 *
 * @example
 * ```ts
 * import { type FieldIssue, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "signup", defaultValues: { email: "" } });
 * form.setError("email", { message: "Already registered", type: "taken" });
 * const issues: readonly FieldIssue[] = form.field("email").errors();
 * console.log(issues[0]?.message, issues[0]?.type); // "Already registered" "taken"
 * ```
 * @since 1.0.0
 */
export interface FieldIssue {
  /** Text for the user. */
  readonly message: string;
  /**
   * What produced it: `"schema"` (the resolver), `"validate"` (a validator, or a validator that
   * threw), `"server"`, `"manual"` (`setError`), `"disabled"` (a required field left out of the
   * data, reported to `onInvalid`) or the type a validator chose.
   */
  readonly type: string;
  /**
   * Extra data a validator attached (limits, codes). A validator that threw or rejected carries
   * the thrown value as `params.error`.
   */
  readonly params?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * What validators, `setError` and `initialErrors` accept for one problem: a message, or an object
 * with a message, an optional `type` (default: the source, such as `"validate"` or `"manual"`)
 * and optional `params`. An empty message means "no problem".
 *
 * @example
 * ```ts
 * import type { IssueInput } from "@shadow-js/forms";
 *
 * function checkAge(age: number): IssueInput | undefined {
 *   if (age < 18) return { message: "Adults only", type: "min", params: { min: 18 } };
 *   return undefined;
 * }
 *
 * console.log(checkAge(16));
 * ```
 * @since 1.0.0
 */
export type IssueInput =
  | string
  | {
      /** Text for the user. An empty message means "no problem". */
      readonly message: string;
      /** What produced it. Default: the source (`"validate"`, `"manual"`, `"server"`...). */
      readonly type?: string | undefined;
      /** Extra data for the UI (limits, codes), kept on the {@link FieldIssue}. */
      readonly params?: Readonly<Record<string, unknown>> | undefined;
    };

/**
 * A problem with its field path: what `form.issues()` and the `onInvalid` callback receive.
 *
 * @example
 * ```ts
 * import { type FormIssue, useForm } from "@shadow-js/forms";
 *
 * function report(issues: readonly FormIssue[]): void {
 *   for (const issue of issues) console.log(`${issue.path || "(form)"}: ${issue.message}`);
 * }
 *
 * const form = useForm({
 *   id: "signup",
 *   defaultValues: { email: "" },
 *   validators: { email: (value: string) => (value.includes("@") ? undefined : "Enter an email") },
 *   onInvalid: report,
 * });
 * await form.handleSubmit(); // logs "email: Enter an email"
 * ```
 * @since 1.0.0
 */
export interface FormIssue extends FieldIssue {
  /** Canonical path of the field (`"lines.0.sku"`), or `""` for a problem of the form as a whole. */
  readonly path: string;
}

/**
 * Why a validation pass is running: `"change"` (a value was written), `"blur"` (a control lost
 * focus), `"submit"`, or `"manual"` (`trigger()`, and the passes a form runs on its own when it is
 * created, reset or a field is disabled).
 *
 * @example
 * ```ts
 * import type { FieldValidator, ValidationTrigger } from "@shadow-js/forms";
 *
 * const strictOn: readonly ValidationTrigger[] = ["blur", "submit", "manual"];
 *
 * export const username: FieldValidator<string> = (value, { trigger }) =>
 *   value.length < 3 && strictOn.includes(trigger) ? "At least 3 characters" : undefined;
 * ```
 * @since 1.0.0
 */
export type ValidationTrigger = "change" | "blur" | "submit" | "manual";

/**
 * Handed to field validators next to the value.
 *
 * @example
 * ```ts
 * import { useForm, type ValidatorContext } from "@shadow-js/forms";
 *
 * interface Account {
 *   password: string;
 *   confirm: string;
 * }
 *
 * function sameAsPassword(value: string, context: ValidatorContext<Account>) {
 *   return value === context.values().password ? undefined : "The passwords differ";
 * }
 *
 * const form = useForm<Account>({
 *   id: "account",
 *   defaultValues: { password: "", confirm: "" },
 *   validators: { confirm: sameAsPassword },
 * });
 * console.log(await form.trigger("confirm")); // true: both are empty
 * ```
 * @since 1.0.0
 */
export interface ValidatorContext<TInput extends object = object> {
  /** Canonical path of the field being checked (`"lines.0.sku"`). */
  readonly path: string;
  /**
   * Aborted when a newer run for the same field starts, the form is reset, or the form is
   * disposed. Pass it to `fetch` in an asynchronous validator (`asyncValidation` feature).
   */
  readonly signal: AbortSignal;
  /** What started this run. */
  readonly trigger: ValidationTrigger;
  /** A plain copy of all values, for rules that compare fields. Copied only when called. */
  values(): TInput;
}

/**
 * What a validator returns: nothing, `null` or `""` (valid), a message, an issue object, or a
 * list of them (`null` and `undefined` entries are skipped).
 *
 * @example
 * ```ts
 * import type { ValidatorResult } from "@shadow-js/forms";
 *
 * function passwordRules(value: string): ValidatorResult {
 *   return [
 *     value.length < 12 ? "At least 12 characters" : null,
 *     /[0-9]/.test(value) ? null : { message: "Add a digit", type: "digit" },
 *   ];
 * }
 *
 * console.log(passwordRules("short"));
 * ```
 * @since 1.0.0
 */
export type ValidatorResult =
  | IssueInput
  | readonly (IssueInput | null | undefined)[]
  | null
  | undefined
  | void;

/**
 * Checks one value. Return a problem to reject it, or nothing to accept it. A validator that
 * throws reports the error's message as a problem instead of breaking the form. A promise (an
 * asynchronous check) needs the `asyncValidation` feature from `@shadow-js/forms/async`: each new
 * run aborts the previous one and its late answer is dropped. Without the feature, a promise is
 * reported as a problem that names the feature.
 *
 * @example
 * ```ts
 * import { type FieldValidator, useForm } from "@shadow-js/forms";
 *
 * const email: FieldValidator<string> = (value) =>
 *   value.includes("@") ? undefined : "Enter an email";
 *
 * const form = useForm({ id: "newsletter", defaultValues: { email: "" } });
 * const field = form.field("email", { validate: email });
 * field.setValue("ada");
 * console.log(await field.trigger(), field.error()); // false "Enter an email"
 * ```
 * @see {@link ValidatorSpec}
 * @since 1.0.0
 */
export type FieldValidator<V = unknown, TInput extends object = object> = (
  value: V,
  context: ValidatorContext<TInput>,
) => ValidatorResult | PromiseLike<ValidatorResult>;

/**
 * A validator with a quiet period: on a change it starts after `debounceMs` without further
 * changes. Blur, submit and `trigger()` run it at once. A `debounceMs` above 0 needs the
 * `asyncValidation` feature: without it, the form (or `form.field`) throws a `TypeError` that
 * names the feature.
 *
 * @example
 * ```ts
 * import { useForm, type ValidatorSpec } from "@shadow-js/forms";
 * import { asyncValidation } from "@shadow-js/forms/async";
 *
 * const usernameFree: ValidatorSpec<string> = {
 *   debounceMs: 300,
 *   validate: async (value, { signal }) => {
 *     const response = await fetch(`/api/usernames/${encodeURIComponent(value)}`, { signal });
 *     return response.status === 404 ? undefined : "This name is taken";
 *   },
 * };
 *
 * const form = useForm({
 *   id: "signup",
 *   features: [asyncValidation],
 *   defaultValues: { username: "" },
 *   validators: { username: usernameFree },
 * });
 * console.log(form.isValidating()); // false until a check runs
 * ```
 * @since 1.0.0
 */
export interface ValidatorSpec<V = unknown, TInput extends object = object> {
  /** The check itself (see {@link FieldValidator}). */
  readonly validate: FieldValidator<V, TInput>;
  /**
   * Quiet period after the last change, in milliseconds. Default 0 (runs at once). Values above 0
   * need the `asyncValidation` feature.
   */
  readonly debounceMs?: number | undefined;
}

/**
 * A validator typed loosely enough that `(value: string) => ...` is accepted where any value may
 * come: the entry type of {@link ValidatorMap}.
 * @since 1.0.0
 */
export type LooseValidator<TInput extends object> = {
  bivarianceHack(
    value: never,
    context: ValidatorContext<TInput>,
  ): ValidatorResult | PromiseLike<ValidatorResult>;
}["bivarianceHack"];

/**
 * Validators keyed by path pattern, for the `validators` option: `"email"`, `"lines.*.sku"` (`*`
 * or `[]` matches any one step). Each value is a {@link FieldValidator} or a
 * {@link ValidatorSpec}. A key that is not a valid pattern makes `useForm` throw a
 * `FormPathError`.
 *
 * @example
 * ```ts
 * import { useForm, type ValidatorMap } from "@shadow-js/forms";
 *
 * interface Order {
 *   lines: { sku: string; qty: number }[];
 * }
 *
 * const validators: ValidatorMap<Order> = {
 *   "lines.*.sku": (sku: string) => (/^[A-Z]-[0-9]+$/.test(sku) ? undefined : "Use the form A-1"),
 *   "lines.*.qty": (qty: number) => (qty > 0 ? undefined : "At least 1"),
 * };
 *
 * const form = useForm<Order>({
 *   id: "order",
 *   defaultValues: { lines: [{ sku: "", qty: 1 }] },
 *   validators,
 * });
 * console.log(await form.trigger(), form.errors()); // false { "lines.0.sku": "Use the form A-1" }
 * ```
 * @since 1.0.0
 */
export type ValidatorMap<TInput extends object = object> = Readonly<
  Record<
    string,
    | LooseValidator<TInput>
    | { readonly validate: LooseValidator<TInput>; readonly debounceMs?: number | undefined }
  >
>;

/**
 * One issue in the list a form-level validator ({@link FormValidator}) may return.
 *
 * @example
 * ```ts
 * import { type FormIssueInput, useForm } from "@shadow-js/forms";
 *
 * interface Team {
 *   members: { name: string }[];
 * }
 *
 * const form = useForm<Team>({
 *   id: "team",
 *   defaultValues: { members: [{ name: "Ada" }, { name: "Ada" }] },
 *   validate: (values) => {
 *     const issues: FormIssueInput[] = [];
 *     values.members.forEach((member, index) => {
 *       if (values.members.findIndex((other) => other.name === member.name) !== index) {
 *         issues.push({ path: ["members", index, "name"], message: "Names must differ" });
 *       }
 *     });
 *     return issues;
 *   },
 * });
 * console.log(form.isValid()); // false
 * ```
 * @since 1.0.0
 */
export interface FormIssueInput {
  /**
   * Field path as text (`"lines.0.sku"`, following the path grammar) or segments
   * (`["lines", 0, "sku"]`). Omit it, or pass `""`, for a problem of the form as a whole.
   */
  readonly path?: string | readonly Segment[] | undefined;
  /** Text for the user. */
  readonly message: string;
  /** What produced it. Default `"validate"`. */
  readonly type?: string | undefined;
}

/**
 * What a form-level `validate` returns: nothing, `null` or `""` (valid), a message for the form as
 * a whole, a map of field path to problem(s) (the key `""` is the form), or a list of
 * {@link FormIssueInput}.
 *
 * @example
 * ```ts
 * import type { FormValidateResult } from "@shadow-js/forms";
 *
 * function checkBooking(values: { checkIn: string; checkOut: string }): FormValidateResult {
 *   if (values.checkIn === "") return { checkIn: "Pick a date" };
 *   if (values.checkOut <= values.checkIn) return { checkOut: "Leave after you arrive" };
 *   return undefined;
 * }
 *
 * console.log(checkBooking({ checkIn: "2026-05-02", checkOut: "2026-05-01" }));
 * ```
 * @since 1.0.0
 */
export type FormValidateResult =
  | string
  | null
  | undefined
  | void
  | Readonly<Record<string, IssueInput | readonly IssueInput[] | null | undefined>>
  | readonly FormIssueInput[];

/**
 * A rule over all values, for cross-field checks: the `validate` option. It receives a plain copy
 * of the values (disabled fields left out, unless `excludeDisabled` is `false`) and the run's
 * `signal` and `trigger`. A throw is reported as a form-level problem. A promise needs the
 * `asyncValidation` feature; without it, the promise is reported as a problem that names the
 * feature.
 *
 * @example
 * ```ts
 * import { type FormValidator, useForm } from "@shadow-js/forms";
 *
 * interface Booking {
 *   checkIn: string;
 *   checkOut: string;
 * }
 *
 * const datesInOrder: FormValidator<Booking> = (values) =>
 *   values.checkOut > values.checkIn ? undefined : { checkOut: "Leave after you arrive" };
 *
 * const form = useForm<Booking>({
 *   id: "booking",
 *   defaultValues: { checkIn: "2026-05-02", checkOut: "2026-05-01" },
 *   validate: datesInOrder,
 * });
 * console.log(form.isValid()); // false
 * ```
 * @since 1.0.0
 */
export type FormValidator<TInput extends object> = (
  values: TInput,
  context: { readonly signal: AbortSignal; readonly trigger: ValidationTrigger },
) => FormValidateResult | PromiseLike<FormValidateResult>;

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

/**
 * When a field's problems first appear (before a submit was attempted). A blur shows the
 * problems of the field that lost focus for every value except `"submit"`.
 *
 * - `"change"`: on every input event.
 * - `"blur"`: when the field loses focus.
 * - `"touched"`: when it loses focus, then live on every input event.
 * - `"submit"`: only when the form is submitted.
 *
 * @example
 * ```ts
 * import { useForm, type ValidateOn } from "@shadow-js/forms";
 *
 * const validateOn: ValidateOn[] = ["blur", "change"];
 * const form = useForm({
 *   id: "profile",
 *   defaultValues: { name: "" },
 *   validateOn,
 *   validators: { name: (value: string) => (value === "" ? "Required" : undefined) },
 * });
 * console.log(form.field("name").error()); // undefined until the field changes or loses focus
 * ```
 * @see {@link ReValidateOn}
 * @since 1.0.0
 */
export type ValidateOn = "change" | "blur" | "touched" | "submit";

/**
 * When problems update after a submit was attempted: `"change"` (every input event), `"blur"`
 * (when a field loses focus) or `"submit"` (only at the next submit).
 *
 * @example
 * ```ts
 * import { type ReValidateOn, useForm } from "@shadow-js/forms";
 *
 * const reValidateOn: ReValidateOn = "blur";
 * const form = useForm({ id: "profile", defaultValues: { name: "" }, reValidateOn });
 * console.log(form.isSubmitted()); // false
 * ```
 * @see {@link ValidateOn}
 * @since 1.0.0
 */
export type ReValidateOn = "change" | "blur" | "submit";

/**
 * React Hook Form's names for the common combinations of {@link ValidateOn}, for the `mode`
 * option: `"onSubmit"` is `validateOn: "submit"`, `"onBlur"` is `"blur"`, `"onChange"` is
 * `"change"`, `"onTouched"` is `"touched"` and `"all"` is `["blur", "change"]`. Each mode
 * re-validates on change after a submit.
 *
 * @example
 * ```ts
 * import { type FormMode, useForm } from "@shadow-js/forms";
 *
 * const mode: FormMode = "onBlur";
 * const form = useForm({ id: "login", mode, defaultValues: { email: "", password: "" } });
 * console.log(form.id); // "login"
 * ```
 * @since 1.0.0
 */
export type FormMode = "onSubmit" | "onBlur" | "onChange" | "onTouched" | "all";

/**
 * How an empty text control is stored: `"string"` stores `""`, `"undefined"` stores `undefined`
 * and `"null"` stores `null`.
 *
 * @example
 * ```ts
 * import { type EmptyValue, useForm } from "@shadow-js/forms";
 *
 * const emptyValue: EmptyValue = "null";
 * const form = useForm({ id: "contact", emptyValue, defaultValues: { phone: null as string | null } });
 * console.log(form.getValues("phone")); // null
 * ```
 * @since 1.0.0
 */
export type EmptyValue = "string" | "undefined" | "null";

/**
 * What `handleSubmit` resolves to. It never rejects: a failure is a result with `ok: false`.
 *
 * - `ok: true`: everything validated and `onSubmit` returned. `data` is the parsed output (the
 *   values when there is no resolver) and `result` is what `onSubmit` returned, awaited.
 * - `ok: false`: see `reason`. `error` is set for `"error"` (what was thrown) and for an
 *   `"invalid"` submit stopped because the schema requires a disabled field.
 *
 * @example
 * ```ts
 * import { type SubmitResult, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({
 *   id: "contact",
 *   defaultValues: { message: "Hello" },
 *   onSubmit: async (values) => {
 *     const response = await fetch("/api/contact", { method: "POST", body: JSON.stringify(values) });
 *     if (!response.ok) throw new Error("The message could not be sent.");
 *     return response.status;
 *   },
 * });
 *
 * const result: SubmitResult<{ message: string }> = await form.handleSubmit();
 * if (result.ok) console.log("sent", result.result);
 * else console.log("not sent:", result.reason);
 * ```
 * @since 1.0.0
 */
export type SubmitResult<TOutput> =
  | {
      /** `true`: the submit went through. */
      readonly ok: true;
      /** The parsed output (the values when there is no resolver). */
      readonly data: TOutput;
      /** What `onSubmit` returned, awaited (`undefined` without `onSubmit`). */
      readonly result: unknown;
    }
  | {
      /** `false`: the submit was stopped or failed; see `reason`. */
      readonly ok: false;
      /** `"invalid"`: validation failed (`error` is set when the schema requires a disabled field). `"error"`: `onSubmit` threw. `"busy"`: already submitting. `"disabled"`: the form is disabled. `"canceled"`: the form was reset or disposed meanwhile. */
      readonly reason: "invalid" | "error" | "busy" | "disabled" | "canceled";
      /** What `onSubmit` threw (`"error"`), or, for an `"invalid"` submit stopped by a required disabled field, an `Error` named `"DisabledFieldError"` that names the field. */
      readonly error?: unknown;
    };

/**
 * Handed to `onSubmit` (and to `handleSubmitWith` handlers) next to the parsed output.
 *
 * @example
 * ```ts
 * import { type SubmitContext, useForm } from "@shadow-js/forms";
 *
 * interface Comment {
 *   body: string;
 * }
 *
 * async function post(output: Comment, context: SubmitContext<Comment, Comment>): Promise<void> {
 *   await fetch("/api/comments", {
 *     method: "POST",
 *     body: JSON.stringify(output),
 *     signal: context.signal,
 *   });
 *   context.form.reset();
 * }
 *
 * const form = useForm<Comment>({ id: "comment", defaultValues: { body: "" }, onSubmit: post });
 * console.log(form.isSubmitting()); // false
 * ```
 * @since 1.0.0
 */
export interface SubmitContext<TInput extends object, TOutput> {
  /** Aborted when the form is reset or disposed while the submit is in flight. */
  readonly signal: AbortSignal;
  /** The form, for `applyServerErrors`, `reset` and the like. */
  readonly form: FormApi<TInput, TOutput>;
  /** A plain copy of the values that were validated (the schema's input), disabled fields left out. */
  readonly input: TInput;
  /** The submit event, when `handleSubmit` was called with one. */
  readonly event: Event | undefined;
}

/**
 * Options of {@link useForm}. Every option is optional; a form with none holds an empty object
 * and validates nothing.
 *
 * @example
 * ```ts
 * import { useForm } from "@shadow-js/forms";
 *
 * const form = useForm({
 *   id: "signup",
 *   defaultValues: { email: "", password: "", confirm: "" },
 *   validators: {
 *     email: (value: string) => (value.includes("@") ? undefined : "Enter an email"),
 *     password: (value: string) => (value.length >= 12 ? undefined : "At least 12 characters"),
 *   },
 *   validate: (values) => (values.confirm === values.password ? undefined : { confirm: "The passwords differ" }),
 *   validateOn: "blur",
 *   reValidateOn: "change",
 *   resetOnSuccess: true,
 *   onSubmit: async (values) => {
 *     await fetch("/api/signup", { method: "POST", body: JSON.stringify(values) });
 *   },
 * });
 * console.log(await form.trigger(), form.errors()["email"]); // false "Enter an email"
 * ```
 * @since 1.0.0
 */
export interface FormOptions<TInput extends object, TOutput = TInput> {
  /**
   * Starting values. Copied: the caller's object is never mutated. A function returning a promise,
   * or a promise, loads them: the form starts empty, `isLoading()` is true until they arrive, and
   * they become the baseline. A failed load is kept for `loadError()`; it never throws.
   * Default: `{}` (or the first value of `values`).
   */
  readonly defaultValues?: DefaultValues<TInput> | AsyncDefaultValues<TInput> | undefined;
  /**
   * Reactive values: whenever the accessor returns a different object, the form resets to it (the
   * values prop of React Hook Form). Its first value, when it is not `undefined`, is the starting
   * value and the baseline, ahead of a synchronous `defaultValues`. Changes are followed only for a
   * form created inside a component.
   */
  readonly values?: Accessor<DefaultValues<TInput> | undefined> | undefined;
  /**
   * A check over all values that returns the parsed output: `standardSchema(schema)` from
   * `@shadow-js/forms/standard-schema` for any Standard Schema (Zod, Valibot, ArkType...). The
   * output is what `onSubmit` receives. Runs next to `validate`. The removed `schema` option throws
   * a `TypeError` that points here.
   */
  readonly resolver?: Resolver<TInput, TOutput> | undefined;
  /**
   * A rule over all values for cross-field checks (see {@link FormValidator}). Runs next to the
   * resolver. It may return a promise only with the `asyncValidation` feature.
   */
  readonly validate?: FormValidator<TInput> | undefined;
  /**
   * Validators by path pattern (see {@link ValidatorMap}), run next to the schema. A pattern
   * outside the path grammar throws a `FormPathError`.
   */
  readonly validators?: ValidatorMap<TInput> | undefined;
  /** When problems first appear. One value or a mix. Default `"touched"` (or what `mode` says). */
  readonly validateOn?: ValidateOn | readonly ValidateOn[] | undefined;
  /** When problems update once a submit was attempted. Default `"change"`. */
  readonly reValidateOn?: ReValidateOn | readonly ReValidateOn[] | undefined;
  /** Shorthand for `validateOn` / `reValidateOn` using React Hook Form's names (see {@link FormMode}). `validateOn` wins when both are given. */
  readonly mode?: FormMode | undefined;
  /** React Hook Form's name for `reValidateOn`: `onChange`, `onBlur` or `onSubmit`. `reValidateOn` wins when both are given. */
  readonly reValidateMode?: ReValidateMode | undefined;
  /**
   * `"all"` (default) keeps every message of a field in `errors()` and `issues()`; `"firstError"`
   * keeps the first one, as React Hook Form does. `error()` always gives the first.
   */
  readonly criteriaMode?: CriteriaMode | undefined;
  /**
   * When a control bound to a field leaves the page, drop that field's value (and its problems) at
   * the next write, as React Hook Form's `shouldUnregister`. Default `false`: the value is kept.
   */
  readonly shouldUnregister?: boolean | undefined;
  /**
   * Quiet period before an asynchronous schema or form validator re-runs after a change, in
   * milliseconds. Default 0. A value above 0 needs the `asyncValidation` feature: without it,
   * `useForm` throws a `TypeError` that names the feature.
   */
  readonly debounceMs?: number | undefined;
  /**
   * Called with the parsed output once everything validates. Its return value (awaited) is the
   * `result` of {@link SubmitResult}. Throw to report a failed submit: the result is
   * `{ ok: false, reason: "error" }` and `submitError()` holds the message.
   */
  readonly onSubmit?:
    | ((output: TOutput, context: SubmitContext<TInput, TOutput>) => unknown)
    | undefined;
  /**
   * Called untracked by `handleSubmit` when validation stops a submit, with the problems found and
   * the event. A throw becomes an error result and `submitError()`, as with `onSubmit`.
   */
  readonly onInvalid?:
    | ((issues: readonly FormIssue[], context: { readonly event: Event | undefined }) => void)
    | undefined;
  /**
   * After a successful submit: `true` restores the default values, `"values"` adopts the submitted
   * values as the new defaults. Default `false`: the values stay as submitted.
   */
  readonly resetOnSuccess?: boolean | "values" | undefined;
  /** Disables submit and every control. May be an accessor to follow a signal. Default `false`. */
  readonly disabled?: boolean | Accessor<boolean> | undefined;
  /** Whether fields marked disabled are left out of the validated and submitted data. Default `true`. */
  readonly excludeDisabled?: boolean | undefined;
  /** Prefix for generated ids. Default: `useId()` inside a component; outside one, `form`, `form-2`... in creation order. */
  readonly id?: string | undefined;
  /** How empty text controls are stored (see {@link EmptyValue}). Default `"string"`. */
  readonly emptyValue?: EmptyValue | undefined;
  /**
   * Problems to show from the start, for example the ones a no-JavaScript form post produced on
   * the server: a map of path to problem(s), or a list of {@link ServerIssue}. Needs the
   * `submitErrors` feature from `@shadow-js/forms/submit-errors`: without it, `useForm` throws a
   * `TypeError` that names the feature.
   */
  readonly initialErrors?:
    | Readonly<Record<string, IssueInput | readonly IssueInput[]>>
    | readonly ServerIssue[]
    | undefined;
  /** Move focus to the first invalid control when a submit fails. Default `true`. */
  readonly shouldFocusError?: boolean | undefined;
}

/**
 * Default values given as a function that returns a promise, or as a promise: they load after
 * the form is created, and the form starts empty until they arrive.
 *
 * @example
 * ```ts
 * import { type AsyncDefaultValues, useForm } from "@shadow-js/forms";
 *
 * interface Profile {
 *   name: string;
 *   bio: string;
 * }
 *
 * const loadProfile: AsyncDefaultValues<Profile> = async () => {
 *   const response = await fetch("/api/profile");
 *   return (await response.json()) as Profile;
 * };
 *
 * const form = useForm<Profile>({ id: "profile", defaultValues: loadProfile });
 * console.log(form.isLoading()); // true until the profile arrives
 * ```
 * @since 1.0.0
 */
export type AsyncDefaultValues<T> = (() => Promise<DefaultValues<T>>) | Promise<DefaultValues<T>>;

/**
 * Which problems a field keeps in `errors()` and `issues()`: the first (`"firstError"`), or all of
 * them (`"all"`).
 *
 * @example
 * ```ts
 * import { type CriteriaMode, useForm } from "@shadow-js/forms";
 *
 * const criteriaMode: CriteriaMode = "firstError";
 * const form = useForm({
 *   id: "password",
 *   criteriaMode,
 *   defaultValues: { password: "" },
 *   validators: { password: () => ["At least 12 characters", "Add a digit"] },
 * });
 * await form.trigger();
 * console.log(form.field("password").errors().length); // 1
 * ```
 * @since 1.0.0
 */
export type CriteriaMode = "firstError" | "all";

/**
 * When problems update after a submit, in React Hook Form's names: `"onChange"`, `"onBlur"` or
 * `"onSubmit"` (the {@link ReValidateOn} values `"change"`, `"blur"`, `"submit"`).
 *
 * @example
 * ```ts
 * import { type ReValidateMode, useForm } from "@shadow-js/forms";
 *
 * const reValidateMode: ReValidateMode = "onBlur";
 * const form = useForm({ id: "login", mode: "onSubmit", reValidateMode, defaultValues: { email: "" } });
 * console.log(form.submitCount()); // 0
 * ```
 * @since 1.0.0
 */
export type ReValidateMode = "onChange" | "onBlur" | "onSubmit";

/**
 * What {@link FormApi.reset} keeps. Each `keep*` flag leaves that part of the state as it is;
 * every flag defaults to `false`.
 *
 * @example
 * ```ts
 * import { type ResetOptions, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "settings", defaultValues: { theme: "light" } });
 * form.setValue("theme", "dark");
 * const keep: ResetOptions = { keepValues: true };
 * form.reset({ theme: "dark" }, keep); // "dark" becomes the baseline
 * console.log(form.isDirty()); // false
 * ```
 * @since 1.0.0
 */
export interface ResetOptions {
  /** Keeps the current values and rows (the new values still become the defaults unless `keepDefaultValues`). */
  readonly keepValues?: boolean | undefined;
  /** Keeps the old defaults: the values change, `isDirty` compares with the old baseline. */
  readonly keepDefaultValues?: boolean | undefined;
  /** Same as `keepDefaultValues`: the dirty baseline is kept. */
  readonly keepDirty?: boolean | undefined;
  /**
   * Keeps the problems (schema, field, server and manual ones) of fields outside field arrays. A
   * reset replaces the rows of an array under new keys, so the problems inside a row are dropped.
   */
  readonly keepErrors?: boolean | undefined;
  /** Keeps which fields lost focus. */
  readonly keepTouched?: boolean | undefined;
  /** Keeps the number of submits. */
  readonly keepSubmitCount?: boolean | undefined;
  /** Keeps `isSubmitted()` and `submitError()`. */
  readonly keepIsSubmitted?: boolean | undefined;
  /** Keeps `isSubmitSuccessful()`. */
  readonly keepIsSubmitSuccessful?: boolean | undefined;
}

/**
 * What {@link FormApi.unregister} keeps. Every flag defaults to `false`.
 *
 * @example
 * ```ts
 * import { type UnregisterOptions, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "signup", defaultValues: { email: "", company: "Acme" } });
 * const keep: UnregisterOptions = { keepValue: true };
 * form.unregister("company", keep);
 * console.log(form.getValues("company")); // "Acme"
 * ```
 * @since 1.0.0
 */
export interface UnregisterOptions {
  /** Keeps the value in the form data. */
  readonly keepValue?: boolean | undefined;
  /** Keeps the problems of the field. */
  readonly keepError?: boolean | undefined;
  /** Keeps the touched flag of the field. */
  readonly keepTouched?: boolean | undefined;
}

/**
 * The state of one field, as getters: each read subscribes to that part only. Returned by
 * `form.getFieldState(path)` and handed to a `Controller` render as `fieldState`.
 *
 * @example
 * ```ts
 * import { type FieldStateView, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "signup", defaultValues: { email: "" } });
 * form.setError("email", "Already registered");
 * const state: FieldStateView = form.getFieldState("email");
 * console.log(state.invalid, state.error); // true "Already registered"
 * ```
 * @since 1.0.0
 */
export interface FieldStateView {
  /** True when a problem is shown. */
  readonly invalid: boolean;
  /** True once the field lost focus (or a submit touched it). */
  readonly isTouched: boolean;
  /** True when the value differs from its default. */
  readonly isDirty: boolean;
  /** True while an asynchronous validator of the field runs. */
  readonly isValidating: boolean;
  /** The first shown message, or `undefined`. */
  readonly error: string | undefined;
  /** Every shown problem (one with `criteriaMode: "firstError"`). */
  readonly errors: readonly FieldIssue[];
}

/**
 * The state of the form, as getters: `form.formState.isDirty` subscribes to `isDirty` only. Each
 * member reads the form accessor of the same name.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function SaveBar() {
 *   const form = useForm({ id: "settings", defaultValues: { theme: "light" } });
 *   return (
 *     <button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
 *       Save
 *     </button>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface FormStateView {
  /** True when any value differs from its default (`form.isDirty()`). */
  readonly isDirty: boolean;
  /** True when no problem exists and the form can be submitted (`form.isValid()`). */
  readonly isValid: boolean;
  /** True once any field lost focus or a submit was attempted (`form.isTouched()`). */
  readonly isTouched: boolean;
  /** True while a submit runs (`form.isSubmitting()`). */
  readonly isSubmitting: boolean;
  /** True while an asynchronous validator runs (`form.isValidating()`). */
  readonly isValidating: boolean;
  /** True once a submit was attempted (`form.isSubmitted()`). */
  readonly isSubmitted: boolean;
  /** True when the last submit finished without error (`form.isSubmitSuccessful()`). */
  readonly isSubmitSuccessful: boolean;
  /** True when the form is disabled (`form.isDisabled()`). */
  readonly isDisabled: boolean;
  /** True while asynchronous `defaultValues` are loading (`form.isLoading()`). */
  readonly isLoading: boolean;
  /** How many submits were attempted (`form.submitCount()`). */
  readonly submitCount: number;
  /** The error the last submit left behind, or `undefined` (`form.submitError()`). */
  readonly submitError: SubmitErrorState | undefined;
  /** The first shown message of each field, by path (`form.errors()`). */
  readonly errors: Readonly<Record<string, string>>;
  /** Paths of the fields that lost focus (`form.touchedFields()`). */
  readonly touchedFields: readonly string[];
  /** Paths of the leaf fields whose value differs from its default, and of arrays and objects whose shape does (`form.dirtyFields()`). */
  readonly dirtyFields: readonly string[];
}

/**
 * One server-side problem, in the shape Standard Schema and `@shadow-js/dusk` use. A list of them
 * may be passed as `initialErrors`.
 *
 * @example
 * ```ts
 * import { type ServerIssue, useForm } from "@shadow-js/forms";
 * import { submitErrors } from "@shadow-js/forms/submit-errors";
 *
 * const fromServer: readonly ServerIssue[] = [{ message: "Already registered", path: ["email"] }];
 * const form = useForm({
 *   id: "signup",
 *   features: [submitErrors],
 *   defaultValues: { email: "ada@example.com" },
 *   initialErrors: fromServer,
 * });
 * console.log(form.errors()); // { email: "Already registered" }
 * ```
 * @since 1.0.0
 */
export interface ServerIssue {
  /** Text for the user. */
  readonly message: string;
  /**
   * Where the problem is: keys and indexes, or Standard Schema path items (`{ key }`). Omit it, or
   * pass an empty list, for the form as a whole; a path with a reserved or empty key also lands
   * on the form as a whole.
   */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

/**
 * The native controls {@link FieldApi.props} and `bind` know how to bind. `"text"` (the default)
 * covers `<input>` types that hold text (`text`, `email`, `password`, `search`, `tel`, `url`).
 *
 * @example
 * ```ts
 * import { bind, type ControlKind, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "settings", defaultValues: { volume: 5 } });
 * const kind = "number" satisfies ControlKind;
 * const props = bind(form.field("volume"), kind);
 * console.log(props.type, props.value); // "number" "5"
 * ```
 * @see {@link ControlTypes}
 * @since 1.0.0
 */
export type ControlKind =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "radio"
  | "select"
  | "file"
  | "date";

/**
 * Attributes every bound control gets. The values are getters, so a spread follows the field.
 *
 * @example
 * ```tsx
 * import { type BaseControlProps, useForm } from "@shadow-js/forms";
 *
 * export function EmailField() {
 *   const form = useForm({ id: "signup", defaultValues: { email: "" } });
 *   const email = form.field("email");
 *   const control: BaseControlProps = email.props();
 *   return (
 *     <>
 *       <label for={control.id}>Email</label>
 *       <input type="email" {...email.props()} />
 *       <p id={email.errorId}>{email.error()}</p>
 *     </>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface BaseControlProps {
  /** The field's id (see {@link FieldApi.id}); a radio button's id ends with `-` and its value. */
  readonly id: string;
  /** The field's canonical path, so a native form post carries the value under it. */
  readonly name: string;
  /** `true` while the field or the form is disabled, otherwise `undefined` (no attribute). */
  readonly disabled: boolean | undefined;
  /** `true` while a problem is shown, otherwise `undefined`. */
  readonly "aria-invalid": true | undefined;
  /** The field's `errorId` while a problem is shown, otherwise `undefined`. */
  readonly "aria-describedby": string | undefined;
  /** Registers the element (focus, DOM sync). Safe to pass to `ref`; `null` is ignored. */
  readonly ref: (element: Element | null) => void;
  /** Marks the field touched and validates it as `validateOn` / `reValidateOn` say. */
  readonly onBlur: (event: Event) => void;
  /** Tracks focus for `field.focused()`. */
  readonly onFocus: (event: Event) => void;
}

/**
 * Props for text-like controls (`<input>` holding text, the default kind).
 *
 * @example
 * ```tsx
 * import { type TextControlProps, useForm } from "@shadow-js/forms";
 *
 * export function NameInput() {
 *   const form = useForm({ id: "profile", defaultValues: { name: "Ada" } });
 *   const props: TextControlProps = form.field("name").props({ trim: true });
 *   return <input autocomplete="name" {...props} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface TextControlProps extends BaseControlProps {
  /**
   * The stored value as text (`""` for `undefined`, `null`, `NaN` and objects). Set as a
   * property. While an IME composition runs, it keeps the text being composed.
   */
  readonly value: string;
  /** Reads the control's text and writes it to the field. */
  readonly onInput: (event: Event) => void;
  /** Starts an IME composition: validation waits and the control is not rewritten. */
  readonly onCompositionStart: (event: Event) => void;
  /** Ends an IME composition: the composed text is written and postponed validation runs. */
  readonly onCompositionEnd: (event: Event) => void;
}

/**
 * Props for `<textarea>`. Like text, plus the text as `children`: a textarea has no `value`
 * attribute, so server-rendered markup (and a page before it hydrates) needs the content.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function BioEditor() {
 *   const form = useForm({ id: "profile", defaultValues: { bio: "" } });
 *   return <textarea rows={4} {...form.field("bio").props({ kind: "textarea" })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface TextareaControlProps extends TextControlProps {
  /** The stored value as text, for server-rendered markup. */
  readonly children: string;
}

/**
 * Props for `<input type="number">`. The control is read as a number (see
 * {@link NumberOptions}). An `<input type="range">` bound through `ref` alone is read the same way.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function QuantityInput() {
 *   const form = useForm({ id: "cart", defaultValues: { quantity: 1 } });
 *   return <input min={1} {...form.field("quantity").props({ kind: "number" })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface NumberControlProps extends BaseControlProps {
  /** Always `"number"`. */
  readonly type: "number";
  /** The stored number as text (numeric text is shown as it is); `""` for `undefined`, `null`, `NaN` and anything else. */
  readonly value: string;
  /** Parses the control's text and writes the number to the field. */
  readonly onInput: (event: Event) => void;
}

/**
 * Props for a single checkbox (the field is a boolean) or a checkbox group member (the field is an
 * array of values, see {@link CheckboxOptions}).
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function Interests() {
 *   const form = useForm({ id: "survey", defaultValues: { agree: false, topics: ["news"] } });
 *   const topics = form.field("topics");
 *   return (
 *     <>
 *       <input {...form.field("agree").props({ kind: "checkbox" })} />
 *       <input {...topics.props({ kind: "checkbox", value: "news" })} />
 *       <input {...topics.props({ kind: "checkbox", value: "sports" })} />
 *     </>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface CheckboxControlProps extends BaseControlProps {
  /** Always `"checkbox"`. */
  readonly type: "checkbox";
  /** The group value this box toggles, or `undefined` for a boolean checkbox. */
  readonly value: string | undefined;
  /** True when the field is `true` (boolean) or its array holds `value` (group). */
  readonly checked: boolean;
  /** Writes `true`/`false`, or adds or removes `value` in the array. */
  readonly onChange: (event: Event) => void;
}

/**
 * Props for one radio button of a group. Each button of the group binds the same field with its
 * own `value`.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function PlanChoice() {
 *   const form = useForm({ id: "billing", defaultValues: { plan: "free" } });
 *   const plan = form.field("plan");
 *   return (
 *     <>
 *       <input {...plan.props({ kind: "radio", value: "free" })} /> Free
 *       <input {...plan.props({ kind: "radio", value: "pro" })} /> Pro
 *     </>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface RadioControlProps extends BaseControlProps {
  /** Always `"radio"`. */
  readonly type: "radio";
  /** The value this button stores when chosen. */
  readonly value: string;
  /** True when the field's value, as text, equals `value`. */
  readonly checked: boolean;
  /** Writes `value` to the field. */
  readonly onChange: (event: Event) => void;
}

/**
 * Props for `<select>`, single or multiple. Give each `<option>` the attributes of
 * {@link FieldApi.optionProps} so the choice also shows in server-rendered markup.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function CountrySelect() {
 *   const form = useForm({ id: "address", defaultValues: { country: "de" } });
 *   const country = form.field("country");
 *   return (
 *     <select {...country.props({ kind: "select" })}>
 *       <option {...country.optionProps("de")}>Germany</option>
 *       <option {...country.optionProps("fr")}>France</option>
 *     </select>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface SelectControlProps extends BaseControlProps {
  /** `true` for a multiple select, otherwise `undefined`. */
  readonly multiple: boolean | undefined;
  /** The chosen value as text. Present for a single select only; a multiple select is selected through its options. */
  readonly value?: string;
  /** Writes the chosen value (or, for a multiple select, the array of chosen values). */
  readonly onChange: (event: Event) => void;
}

/**
 * Props for one `<option>` of a bound select, from {@link FieldApi.optionProps}.
 *
 * @example
 * ```tsx
 * import { type OptionProps, useForm } from "@shadow-js/forms";
 *
 * export function SizeSelect() {
 *   const form = useForm({ id: "order", defaultValues: { sizes: ["m"] } });
 *   const sizes = form.field("sizes");
 *   const medium: OptionProps = sizes.optionProps("m");
 *   return (
 *     <select {...sizes.props({ kind: "select", multiple: true })}>
 *       <option {...sizes.optionProps("s")}>Small</option>
 *       <option {...medium}>Medium</option>
 *     </select>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface OptionProps {
  /** The option's value. */
  readonly value: string;
  /** True while the field holds `value` (as text) or, for an array, contains it. */
  readonly selected: boolean;
}

/**
 * Props for `<input type="file">`. The input cannot show a value; a cleared field clears the input.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function AttachmentsInput() {
 *   const form = useForm({ id: "ticket", defaultValues: { files: [] as File[] } });
 *   return <input accept="image/*" {...form.field("files").props({ kind: "file", multiple: true })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface FileControlProps extends BaseControlProps {
  /** Always `"file"`. */
  readonly type: "file";
  /** `true` when the field stores a list of files, otherwise `undefined`. */
  readonly multiple: boolean | undefined;
  /** Writes the chosen file (`File | undefined`) or the list of files. */
  readonly onChange: (event: Event) => void;
}

/**
 * Props for `date`, `datetime-local`, `time`, `month` and `week` inputs (see {@link DateOptions}).
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function DeliveryDate() {
 *   const form = useForm({ id: "delivery", defaultValues: { on: new Date(Date.UTC(2026, 4, 1)) } });
 *   return <input {...form.field("on").props({ kind: "date", as: "date" })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface DateControlProps extends BaseControlProps {
  /** The input type from the options. Default `"date"`. */
  readonly type: DateInputType;
  /** The stored value as the input's text (`"2026-05-01"`); `""` when it is empty or not a date. */
  readonly value: string;
  /** Reads the control's text and writes it as the options' `as` says. */
  readonly onInput: (event: Event) => void;
}

/**
 * Input types the `date` kind supports.
 *
 * @example
 * ```tsx
 * import { type DateInputType, useForm } from "@shadow-js/forms";
 *
 * export function MeetingTime() {
 *   const form = useForm({ id: "meeting", defaultValues: { at: "" } });
 *   const type: DateInputType = "datetime-local";
 *   return <input {...form.field("at").props({ kind: "date", type })} />;
 * }
 * ```
 * @since 1.0.0
 */
export type DateInputType = "date" | "datetime-local" | "time" | "month" | "week";

/**
 * Options for the `text` kind, the default of `field.props()`.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function NicknameInput() {
 *   const form = useForm({ id: "profile", defaultValues: { nickname: undefined as string | undefined } });
 *   return <input {...form.field("nickname").props({ empty: "undefined", trim: true })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface TextOptions {
  /** The kind. Default `"text"`. */
  readonly kind?: "text" | undefined;
  /** How an empty control is stored (see {@link EmptyValue}). Default: the form's `emptyValue`. */
  readonly empty?: EmptyValue | undefined;
  /**
   * Store the text without leading and trailing spaces. The bound `value` is rewritten only when
   * the stored text changes: a space typed at the end stays while the next word is typed (the
   * stored text did not change), and leading spaces disappear as soon as a letter follows them.
   * Text of only spaces is empty (see `empty`). Default `false`.
   */
  readonly trim?: boolean | undefined;
}

/**
 * Options for the `textarea` kind.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function NotesInput() {
 *   const form = useForm({ id: "ticket", defaultValues: { notes: "" } });
 *   return <textarea {...form.field("notes").props({ kind: "textarea", trim: true })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface TextareaOptions {
  /** Selects the `textarea` kind. */
  readonly kind: "textarea";
  /** How an empty control is stored (see {@link EmptyValue}). Default: the form's `emptyValue`. */
  readonly empty?: EmptyValue | undefined;
  /**
   * Store the text without leading and trailing spaces. The bound `value` is rewritten only when
   * the stored text changes: a space typed at the end stays while the next word is typed (the
   * stored text did not change), and leading spaces disappear as soon as a letter follows them.
   * Text of only spaces is empty (see `empty`). Default `false`.
   */
  readonly trim?: boolean | undefined;
}

/**
 * Options for the `number` kind. The control's text is trimmed and read with `Number(...)`.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function PriceInput() {
 *   const form = useForm({ id: "product", defaultValues: { price: null as number | null } });
 *   return <input step="0.01" {...form.field("price").props({ kind: "number", empty: "null" })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface NumberOptions {
  /** Selects the `number` kind. */
  readonly kind: "number";
  /** How an empty control is stored: `undefined` or `null`. Default `"undefined"`. */
  readonly empty?: "undefined" | "null" | undefined;
  /** What text that is not a number (for example `"-"` while typing) is stored as: `undefined` or `NaN`. Default `"undefined"`. */
  readonly invalid?: "undefined" | "nan" | undefined;
}

/**
 * Options for the `checkbox` kind. With `value`, the field is an array and the box toggles that
 * value in it; without, the field is a boolean.
 *
 * @example
 * ```tsx
 * import { type CheckboxOptions, useForm } from "@shadow-js/forms";
 *
 * export function NewsTopic() {
 *   const form = useForm({ id: "survey", defaultValues: { topics: [] as string[] } });
 *   const news: CheckboxOptions = { kind: "checkbox", value: "news" };
 *   return <input {...form.field("topics").props(news)} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface CheckboxOptions {
  /** Selects the `checkbox` kind. */
  readonly kind: "checkbox";
  /** The value this box adds to (checked) or removes from (unchecked) the field's array. Omit for a boolean field. */
  readonly value?: string | undefined;
}

/**
 * Options for one radio button.
 *
 * @example
 * ```tsx
 * import { type RadioOptions, useForm } from "@shadow-js/forms";
 *
 * export function ProPlan() {
 *   const form = useForm({ id: "billing", defaultValues: { plan: "free" } });
 *   const pro: RadioOptions = { kind: "radio", value: "pro" };
 *   return <input {...form.field("plan").props(pro)} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface RadioOptions {
  /** Selects the `radio` kind. */
  readonly kind: "radio";
  /** The value the button stores when chosen. Required. */
  readonly value: string;
}

/**
 * Options for the `select` kind.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function ColorSelect() {
 *   const form = useForm({ id: "theme", defaultValues: { color: null as string | null } });
 *   const color = form.field("color");
 *   return (
 *     <select {...color.props({ kind: "select", empty: "null" })}>
 *       <option {...color.optionProps("")}>No color</option>
 *       <option {...color.optionProps("red")}>Red</option>
 *     </select>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface SelectOptions {
  /** Selects the `select` kind. */
  readonly kind: "select";
  /** A multiple select stores an array of option values. Default `false`. */
  readonly multiple?: boolean | undefined;
  /** How an empty choice (`value=""`) is stored by a single select (see {@link EmptyValue}). Default: the form's `emptyValue`. */
  readonly empty?: EmptyValue | undefined;
}

/**
 * Options for the `file` kind.
 *
 * @example
 * ```tsx
 * import { type FileOptions, useForm } from "@shadow-js/forms";
 *
 * export function AvatarInput() {
 *   const form = useForm({ id: "profile", defaultValues: { avatar: undefined as File | undefined } });
 *   const single: FileOptions = { kind: "file" };
 *   return <input accept="image/png" {...form.field("avatar").props(single)} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface FileOptions {
  /** Selects the `file` kind. */
  readonly kind: "file";
  /** Store an array of files. Default `false`: a single `File | undefined`. */
  readonly multiple?: boolean | undefined;
}

/**
 * Options for the `date` kind. Text that is not a valid date is stored as `undefined` by
 * `as: "date"` and `as: "number"`.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function ReminderTime() {
 *   const form = useForm({ id: "reminder", defaultValues: { at: 9 * 60 * 60 * 1000 } });
 *   return <input {...form.field("at").props({ kind: "date", type: "time", as: "number" })} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface DateOptions {
  /** Selects the `date` kind. */
  readonly kind: "date";
  /** The input type. Default `"date"`. */
  readonly type?: DateInputType | undefined;
  /**
   * What is stored: the input's text (`"string"`), a `Date`, or epoch milliseconds (`"number"`; for
   * `time`, milliseconds since midnight). Default `"string"`. A `week` input can only be stored as
   * text: any other `as` makes `props()` throw a `TypeError`.
   */
  readonly as?: "string" | "date" | "number" | undefined;
  /** How an empty control is stored by `as: "string"` (see {@link EmptyValue}). Default: the form's `emptyValue`. */
  readonly empty?: EmptyValue | undefined;
}

/**
 * Maps each {@link ControlKind} to its options and props: `ControlTypes["number"]["props"]` is
 * {@link NumberControlProps}.
 *
 * @example
 * ```ts
 * import type { ControlTypes } from "@shadow-js/forms";
 *
 * type DateProps = ControlTypes["date"]["props"];
 * const options: ControlTypes["date"]["options"] = { kind: "date", type: "month" };
 * const pick = (props: DateProps): string => props.value;
 * console.log(options, pick);
 * ```
 * @since 1.0.0
 */
export interface ControlTypes {
  /** A text `<input>`: {@link TextOptions} and {@link TextControlProps}. */
  text: { options: TextOptions; props: TextControlProps };
  /** A `<textarea>`: {@link TextareaOptions} and {@link TextareaControlProps}. */
  textarea: { options: TextareaOptions; props: TextareaControlProps };
  /** A number `<input>`: {@link NumberOptions} and {@link NumberControlProps}. */
  number: { options: NumberOptions; props: NumberControlProps };
  /** A checkbox: {@link CheckboxOptions} and {@link CheckboxControlProps}. */
  checkbox: { options: CheckboxOptions; props: CheckboxControlProps };
  /** A radio button: {@link RadioOptions} and {@link RadioControlProps}. */
  radio: { options: RadioOptions; props: RadioControlProps };
  /** A `<select>`: {@link SelectOptions} and {@link SelectControlProps}. */
  select: { options: SelectOptions; props: SelectControlProps };
  /** A file `<input>`: {@link FileOptions} and {@link FileControlProps}. */
  file: { options: FileOptions; props: FileControlProps };
  /** A date-like `<input>`: {@link DateOptions} and {@link DateControlProps}. */
  date: { options: DateOptions; props: DateControlProps };
}

// ---------------------------------------------------------------------------------------------
// Field, array and row handles
// ---------------------------------------------------------------------------------------------

/**
 * Options of {@link FieldApi.setValue} and {@link FormApi.setValue} (and `setValues`).
 *
 * @example
 * ```ts
 * import { type SetValueOptions, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "address", defaultValues: { city: "" } });
 * const quiet: SetValueOptions = { validate: false, touch: true };
 * form.setValue("city", "Lisbon", quiet);
 * console.log(form.field("city").touched()); // true
 * ```
 * @since 1.0.0
 */
export interface SetValueOptions {
  /** Run validation after the write (shown as `validateOn` / `reValidateOn` say). Default `true`. */
  readonly validate?: boolean | undefined;
  /** Mark the field touched. Default `false`. */
  readonly touch?: boolean | undefined;
}

/**
 * Options of `form.field(path, options)`.
 *
 * @example
 * ```ts
 * import { type FieldOptions, useForm } from "@shadow-js/forms";
 *
 * interface Signup {
 *   email: string;
 *   referrer: string;
 * }
 *
 * const form = useForm<Signup>({ id: "signup", defaultValues: { email: "", referrer: "" } });
 * const options: FieldOptions<string, Signup> = {
 *   validate: (value) => (value.endsWith("@example.com") ? "Use your own address" : undefined),
 * };
 * const email = form.field("email", options);
 * const referrer = form.field("referrer", { disabled: true });
 * console.log(email.path, referrer.disabled()); // "email" true
 * ```
 * @since 1.0.0
 */
export interface FieldOptions<V = unknown, TInput extends object = object> {
  /**
   * A validator for this field. Called inside a component, it is removed when that component is
   * disposed; outside one, it lasts as long as the form. Passing the same function again for the
   * same field adds nothing. A `debounceMs` above 0 needs the `asyncValidation` feature: without
   * it, `form.field` throws a `TypeError`.
   */
  readonly validate?: FieldValidator<V, TInput> | ValidatorSpec<V, TInput> | undefined;
  /** `true` disables the field (as {@link FieldApi.setDisabled}). `false` or omitted changes nothing. */
  readonly disabled?: boolean | undefined;
}

/**
 * The handle for one value of the form, from `form.field(path)`. Reads (`value()`, `error()`, ...)
 * are reactive and read only what they name: a keystroke in one field re-runs the readers of that
 * field.
 *
 * The shape `{ value, error, touched, onInput, onBlur }` is the contract UI kits (such as the
 * shadcn wrapper) build on; it stays stable.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function EmailInput() {
 *   const form = useForm({ id: "signup", defaultValues: { email: "" } });
 *   const email = form.field("email");
 *   return (
 *     <>
 *       <input type="email" {...email.props()} />
 *       <p id={email.errorId}>{email.error()}</p>
 *     </>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface FieldApi<V> {
  /** Canonical path (`"lines.2.sku"`). For a field of a row it follows the row when it moves. */
  readonly path: string;
  /** Id for the control, built from the form's id and the field's location: stable across renders and equal on server and client. */
  readonly id: string;
  /** Id of the element that shows the error (`${id}-error`), for `aria-describedby`. */
  readonly errorId: string;

  /** The current value. */
  value(): V;
  /** The first message to show, or `undefined`. It appears according to `validateOn` / `reValidateOn`. */
  error(): string | undefined;
  /** All problems to show (only the first with `criteriaMode: "firstError"`). */
  errors(): readonly FieldIssue[];
  /** True when a problem is shown. */
  invalid(): boolean;
  /** True once the field (or, for an object or array, anything in it) lost focus. */
  touched(): boolean;
  /**
   * True when the value differs from its default value. A row is compared with its own default; a
   * value that differs is dirty only while the form is (a list equal to its defaults as a whole is
   * clean, so none of its rows or fields is dirty).
   */
  dirty(): boolean;
  /** True while an asynchronous validator is running for this field. */
  validating(): boolean;
  /** True when the field or the whole form is disabled. */
  disabled(): boolean;
  /** True while one of its controls has focus. */
  focused(): boolean;

  /**
   * Replaces the value, or applies an updater to a copy of the current value, and validates
   * according to the form's rules. A write that changes the value clears the problems set by hand
   * or by the server at and below the field.
   */
  setValue(value: V | ((previous: V) => V), options?: SetValueOptions): void;
  /**
   * Shows a problem now, of type `"manual"` unless the issue names one. `undefined` removes the
   * problems set this way. They are cleared by the next change of this field and by the next submit.
   */
  setError(error: IssueInput | readonly IssueInput[] | undefined): void;
  /**
   * Hides every problem shown for this field and removes the ones set by hand or by the server.
   * Problems the schema or a validator still finds come back at the next validation that shows them.
   */
  clearError(): void;
  /** Marks the field touched (default `true`) or untouched (`false`). */
  setTouched(touched?: boolean): void;
  /**
   * Disables or enables the field's controls. While `excludeDisabled` is on (the default), a
   * disabled field is left out of the validated and submitted data and its problems are dropped.
   */
  setDisabled(disabled: boolean): void;
  /** Validates this field (and what is below it) now, ignoring `validateOn`. Resolves to whether it is valid. */
  trigger(): Promise<boolean>;
  /** Restores the default value and clears touched state and problems at and below the field. */
  reset(): void;
  /** Moves focus to this field's first connected, enabled control. False when there is none. */
  focus(): boolean;
  /** The connected controls bound to this field. */
  elements(): readonly Element[];

  /** `input` event handler for text-like controls. Reads the control's value. */
  onInput(event: Event): void;
  /** `change` event handler for checkboxes, radios, selects and files. */
  onChange(event: Event): void;
  /** Marks the field touched and validates according to the rules. */
  onBlur(event?: Event): void;
  /** Tracks focus for {@link FieldApi.focused}. */
  onFocus(event?: Event): void;

  /**
   * Attributes and handlers for a native control, ready to spread. The value is set as a
   * property, an IME composition is never interrupted, and the control follows the field even
   * after the user typed. Without options the kind is `"text"`; the same kind and options return
   * the same object. `{ kind: "date", type: "week" }` with an `as` other than `"string"` throws a
   * `TypeError`.
   */
  props<K extends ControlKind = "text">(
    options?: ControlTypes[K]["options"] & { readonly kind?: K },
  ): ControlTypes[K]["props"];
  /**
   * Registers a control without the rest of {@link FieldApi.props} (custom components). The control
   * kind is read from the element. `null` is ignored.
   */
  ref(element: Element | null): void;
  /**
   * Attributes for an `<option>` of a bound `<select>`: its value, and `selected` while the field
   * holds it (or, for a multiple select, contains it). Also marks the option in server-rendered markup.
   */
  optionProps(value: string): OptionProps;

  /** A field below this one: `user.field("emails.0.address")`. Throws a `FormPathError` for a malformed path. */
  field<P extends Path<NonNullable<V>>>(path: P): FieldApi<PathValue<NonNullable<V>, P>>;
}

/**
 * One row of a field array. Its state follows the row when the list changes: moving, inserting
 * or removing other rows never moves its errors, touched flags or controls.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * export function Lines() {
 *   const form = useForm({
 *     id: "order",
 *     features: [fieldArrays],
 *     defaultValues: { lines: [{ sku: "A-1" }, { sku: "B-2" }] },
 *   });
 *   return (
 *     <ul>
 *       {form.fields("lines").each((row) => (
 *         <li>
 *           <input {...row.field("sku").props()} />
 *           <button type="button" onClick={() => row.moveTo(0)} disabled={row.index() === 0}>
 *             Move to top
 *           </button>
 *           <button type="button" onClick={() => row.remove()}>
 *             Remove
 *           </button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface RowApi<I> {
  /** Stable key of the row: use it as the `key` of your list. */
  readonly key: string;
  /** Current position. Reactive. `-1` once the row was removed. */
  index(): number;
  /** The row's value. */
  value(): I;
  /** True when the row did not exist among the default values. */
  isNew(): boolean;
  /**
   * True when the row differs from its own default value: a moved row is compared with the default
   * it started from, and a row added after the defaults with the default at its current position.
   * A row is dirty only while the form is: when the list equals its defaults as a whole, no row is
   * dirty, so `dirty()` and `form.isDirty()` always agree.
   */
  dirty(): boolean;
  /** The field of the row itself (useful for arrays of primitives). */
  field(): FieldApi<I>;
  /** A field inside the row: `row.field("sku")`. */
  field<P extends Path<NonNullable<I>>>(path: P): FieldApi<PathValue<NonNullable<I>, P>>;
  /** Removes the row. Does nothing once it is gone. */
  remove(): void;
  /** Moves the row to position `to`. Throws a `RangeError` when `to` is out of range. */
  moveTo(to: number): void;
}

/**
 * Helpers for an array value, from `form.fields(path)` (the `fieldArrays` feature). Rows get
 * stable keys, so they keep their identity (DOM, focus, errors) while rows around them are added,
 * removed or moved. An index out of range throws a `RangeError`, and a value at the path that is
 * not an array (nor missing) throws a `TypeError`.
 *
 * @example
 * ```ts
 * import { useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * const form = useForm({
 *   id: "team",
 *   features: [fieldArrays],
 *   defaultValues: { members: [{ name: "Ada" }] },
 * });
 * const members = form.fields("members");
 * members.append({ name: "Grace" }, { name: "Linus" });
 * members.move(2, 0);
 * console.log(members.length(), members.at(0).value().name); // 3 "Linus"
 * ```
 * @since 1.0.0
 */
export interface FieldArrayApi<I> {
  /** Canonical path of the array. */
  readonly path: string;
  /** Stable row keys in order. Reactive. */
  keys(): readonly string[];
  /** Number of rows. Reactive. `0` when the value is missing. */
  length(): number;
  /** The row with this key. Throws a `RangeError` when it does not exist. */
  row(key: string): RowApi<I>;
  /** The row currently at `index`. Throws a `RangeError` when the index is out of range. */
  at(index: number): RowApi<I>;
  /** Adds rows at the end. */
  append(...items: I[]): void;
  /** Adds rows at the start. */
  prepend(...items: I[]): void;
  /** Adds rows before position `index` (`0` to the length). */
  insert(index: number, ...items: I[]): void;
  /** Removes the row at `index`, or several rows. */
  remove(index: number | readonly number[]): void;
  /** Moves one row from `from` to `to`; the rows between shift by one. */
  move(from: number, to: number): void;
  /** Swaps two rows. */
  swap(a: number, b: number): void;
  /** Replaces the row at `index` with a new value (the row keeps its key). */
  update(index: number, item: I): void;
  /** Replaces all rows. New rows get new keys. */
  replace(items: readonly I[]): void;
  /** Removes all rows. */
  clear(): void;
  /**
   * Maps rows to output, keeping each row's output (and DOM) while it exists. `render` runs once
   * per row; `index` is the row's current position.
   *
   * @example
   * ```tsx
   * import { useForm } from "@shadow-js/forms";
   * import { fieldArrays } from "@shadow-js/forms/arrays";
   *
   * export function TagList() {
   *   const form = useForm({ id: "post", features: [fieldArrays], defaultValues: { tags: [{ name: "news" }] } });
   *   return <ul>{form.fields("tags").each((row) => <li>{row.field("name").value()}</li>)}</ul>;
   * }
   * ```
   */
  each<R>(render: (row: RowApi<I>, index: Accessor<number>) => R): Accessor<R[]>;
}

// ---------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------

/**
 * Attributes for a `<form>` element, ready to spread: what `form.props()` returns.
 *
 * @example
 * ```tsx
 * import { type FormElementProps, useForm } from "@shadow-js/forms";
 *
 * export function SearchForm() {
 *   const form = useForm({ id: "search", defaultValues: { query: "" } });
 *   const attributes: FormElementProps = form.props();
 *   return (
 *     <form {...attributes} role="search">
 *       <input type="search" {...form.field("query").props()} />
 *     </form>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface FormElementProps {
  /** The form's id. */
  readonly id: string;
  /** Always `true`: the form validates, not the browser. */
  readonly noValidate: true;
  /** `true` while a submit runs, otherwise `undefined`. */
  readonly "aria-busy": true | undefined;
  /** Calls `handleSubmit` with the event (which prevents the default action). */
  readonly onSubmit: (event: Event) => void;
}

// ---------------------------------------------------------------------------------------------
// Resolvers and features
// ---------------------------------------------------------------------------------------------

/**
 * What a resolver is given on each check.
 *
 * @example
 * ```ts
 * import type { Resolver, ResolverContext } from "@shadow-js/forms";
 *
 * export const loggingResolver: Resolver<{ email: string }> = {
 *   validate: (values: unknown, context: ResolverContext) => {
 *     console.log("checking on", context.trigger);
 *     return { value: values as { email: string } };
 *   },
 * };
 * ```
 * @since 1.0.0
 */
export interface ResolverContext {
  /** Aborted when a newer check starts, or the form is reset or disposed. */
  readonly signal: AbortSignal;
  /** What started the check (`"manual"` for the checks a form runs on its own). */
  readonly trigger: ValidationTrigger;
}

/**
 * A problem a resolver found. `path` names the field (an empty path is the form as a whole).
 *
 * @example
 * ```ts
 * import type { ResolverIssue } from "@shadow-js/forms";
 *
 * const issue: ResolverIssue = { path: ["lines", 0, "sku"], message: "Unknown product" };
 * console.log(issue.type ?? "schema"); // the type a resolver issue gets when it names none
 * ```
 * @since 1.0.0
 */
export interface ResolverIssue {
  /** Segments of the field path; `[]` for the form as a whole. */
  readonly path: readonly Segment[];
  /** Text for the user. */
  readonly message: string;
  /** What produced it. Default `"schema"`. */
  readonly type?: string | undefined;
}

/**
 * What a resolver answers: the problems it found (`issues`), or the parsed output (`value`).
 *
 * @example
 * ```ts
 * import type { ResolverResult } from "@shadow-js/forms";
 *
 * function parseAge(values: { age: string }): ResolverResult<{ age: number }> {
 *   const age = Number(values.age);
 *   if (Number.isNaN(age)) return { issues: [{ path: ["age"], message: "Enter a number" }] };
 *   return { value: { age } };
 * }
 *
 * console.log(parseAge({ age: "42" })); // { value: { age: 42 } }
 * ```
 * @since 1.0.0
 */
export type ResolverResult<TOutput> =
  | {
      /** The problems found. An empty list gives no output either, so a submit stops as `"invalid"`. */
      readonly issues: readonly ResolverIssue[];
      /** Absent when there are problems. */
      readonly value?: undefined;
    }
  | {
      /** The parsed output: what `onSubmit` receives. */
      readonly value: TOutput;
      /** Absent on success. */
      readonly issues?: undefined;
    };

/**
 * A check over all values that answers with problems or the parsed output. Build one from any
 * Standard Schema with `standardSchema(schema)` from `@shadow-js/forms/standard-schema`, or write
 * one by hand. `TInput` and `TOutput` are inferred from it; `types` exists for that and is never
 * read. A resolver that throws reports the error as a form-level problem.
 *
 * @example
 * ```ts
 * import { type Resolver, useForm } from "@shadow-js/forms";
 *
 * const ageResolver: Resolver<{ age: string }, { age: number }> = {
 *   validate: (values) => {
 *     const age = Number((values as { age: string }).age);
 *     return Number.isInteger(age) && age >= 18
 *       ? { value: { age } }
 *       : { issues: [{ path: ["age"], message: "Enter an age of 18 or more" }] };
 *   },
 * };
 *
 * const form = useForm({
 *   id: "age",
 *   resolver: ageResolver,
 *   defaultValues: { age: "21" },
 *   onSubmit: (output) => console.log(output.age + 1), // output.age is a number
 * });
 * await form.handleSubmit(); // logs 22
 * ```
 * @since 1.0.0
 */
export interface Resolver<TInput extends object, TOutput = TInput> {
  /**
   * Checks the values (a plain copy, disabled fields left out unless `excludeDisabled` is
   * `false`). May return a promise only with the `asyncValidation` feature.
   */
  readonly validate: (
    values: unknown,
    context: ResolverContext,
  ) => ResolverResult<TOutput> | PromiseLike<ResolverResult<TOutput>>;
  /** Inference only. Never read at runtime. */
  readonly types?: { readonly input: TInput; readonly output: TOutput } | undefined;
}

/**
 * The opt-in capabilities of a form. Pass them in `useForm({ features: [...] })`: a form without a
 * feature does not contain its code, so a single-field form pays for none of them.
 *
 * - `"arrays"`: `fieldArrays` from `@shadow-js/forms/arrays` (`form.fields`, `<FieldArray>`).
 * - `"asyncValidation"`: `asyncValidation` from `@shadow-js/forms/async` (promises, `debounceMs`).
 * - `"submitErrors"`: `submitErrors` from `@shadow-js/forms/submit-errors` (problems carried by a
 *   thrown error, `initialErrors`).
 * - `"dates"`: `dates` from `@shadow-js/forms/dates` (the date, time, month, week and datetime-local
 *   controls).
 *
 * @example
 * ```ts
 * import type { FeatureName } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * const name: FeatureName = fieldArrays.name;
 * console.log(name); // "arrays"
 * ```
 * @since 1.0.0
 */
export type FeatureName = "arrays" | "asyncValidation" | "submitErrors" | "dates";

/**
 * One opt-in feature. The objects come from their subpaths: `fieldArrays` from
 * `@shadow-js/forms/arrays`, `asyncValidation` from `@shadow-js/forms/async`, `submitErrors` from
 * `@shadow-js/forms/submit-errors` and `dates` from `@shadow-js/forms/dates`.
 *
 * @example
 * ```ts
 * import { type FormFeature, useForm } from "@shadow-js/forms";
 * import { asyncValidation } from "@shadow-js/forms/async";
 * import { submitErrors } from "@shadow-js/forms/submit-errors";
 *
 * const features: readonly FormFeature[] = [asyncValidation, submitErrors];
 * const form = useForm({ id: "signup", features, defaultValues: { email: "" } });
 * console.log(features.map((feature) => feature.name), form.id); // ["asyncValidation", "submitErrors"] "signup"
 * ```
 * @since 1.0.0
 */
export interface FormFeature<N extends FeatureName = FeatureName> {
  /** The feature's name. The API it adds is typed by this name (see {@link FeatureApi}). */
  readonly name: N;
  /** Attaches the feature to a new form. Called once by `useForm`, before the form validates. */
  readonly install: (host: FeatureHost) => void;
}

/**
 * The members a list of features adds to the form. `form.fields` is typed only when the list has
 * the `arrays` feature, so calling it without the feature does not compile.
 *
 * @example
 * ```ts
 * import { type FeatureApi, type FormApi, useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * interface Order {
 *   lines: { sku: string }[];
 * }
 *
 * type OrderForm = FormApi<Order> & FeatureApi<Order, readonly [typeof fieldArrays]>;
 *
 * const form: OrderForm = useForm({
 *   id: "order",
 *   features: [fieldArrays],
 *   defaultValues: { lines: [{ sku: "A-1" }] },
 * });
 * form.fields("lines").append({ sku: "B-2" });
 * ```
 * @since 1.0.0
 */
export type FeatureApi<
  TInput extends object,
  F extends readonly FormFeature[],
> = "arrays" extends F[number]["name"] ? FieldArraysApi<TInput> : unknown;

/**
 * The array helpers that the `arrays` feature adds to a form.
 *
 * @example
 * ```ts
 * import { type FieldArraysApi, useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * interface Survey {
 *   answers: string[];
 * }
 *
 * function addAnswer(form: FieldArraysApi<Survey>, answer: string): void {
 *   form.fields("answers").append(answer);
 * }
 *
 * const form = useForm({ id: "survey", features: [fieldArrays], defaultValues: { answers: [] as string[] } });
 * addAnswer(form, "Yes");
 * console.log(form.getValues("answers")); // ["Yes"]
 * ```
 * @since 1.0.0
 */
export interface FieldArraysApi<TInput extends object> {
  /** Helpers for the array at `path`: rows with stable keys, and the operations on the list. */
  fields<P extends ArrayPath<TInput>>(path: P): FieldArrayApi<ArrayItem<TInput, P>>;
}

/**
 * Options of {@link useForm} with a list of features. The features are typed by their names.
 *
 * @example
 * ```ts
 * import { useForm, type UseFormOptions } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * interface Playlist {
 *   songs: { title: string }[];
 * }
 *
 * const features = [fieldArrays] as const;
 * const options: UseFormOptions<Playlist, Playlist, typeof features> & { features: typeof features } = {
 *   id: "playlist",
 *   features,
 *   defaultValues: { songs: [] },
 * };
 * const form = useForm(options);
 * form.fields("songs").append({ title: "Intro" });
 * ```
 * @since 1.0.0
 */
export interface UseFormOptions<
  TInput extends object,
  TOutput = TInput,
  F extends readonly FormFeature[] = readonly [],
> extends FormOptions<TInput, TOutput> {
  /** The opt-in features of this form (see {@link FormFeature}). Default: none. */
  readonly features?: F | undefined;
}

/**
 * The object {@link useForm} returns: field handles, reactive state accessors and actions. Every
 * accessor subscribes to exactly the state it reads.
 *
 * @example
 * ```tsx
 * import { useForm } from "@shadow-js/forms";
 *
 * export function Signup() {
 *   const form = useForm({
 *     defaultValues: { email: "" },
 *     validators: { email: (value: string) => (value.includes("@") ? undefined : "Enter an email") },
 *     onSubmit: async (values) => {
 *       await fetch("/api/signup", { method: "POST", body: JSON.stringify(values) });
 *     },
 *   });
 *   const email = form.field("email");
 *   return (
 *     <form {...form.props()}>
 *       <input type="email" {...email.props()} />
 *       <p id={email.errorId}>{email.error()}</p>
 *       <button type="submit" disabled={form.isSubmitting()}>
 *         Sign up
 *       </button>
 *       <p>{form.submitError()?.message}</p>
 *     </form>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface FormApi<TInput extends object, TOutput = TInput> {
  /** Prefix of the ids the form generates (the `id` option, or the generated one). */
  readonly id: string;
  /** Deep, read-only, fine-grained view of the values: a read subscribes to exactly what it reads. */
  readonly values: Store<TInput>;

  /**
   * The handle of one value. Calls with the same path return the same handle (up to 4096 cached
   * handles; older ones are recreated on demand). Throws a `FormPathError` for a malformed path.
   */
  field<P extends Path<TInput>>(
    path: P,
    options?: FieldOptions<PathValue<TInput, P>, TInput>,
  ): FieldApi<PathValue<TInput, P>>;
  /** Like {@link FormApi.field} for paths that are only known at run time. */
  fieldAt(path: string, options?: FieldOptions<unknown, TInput>): FieldApi<unknown>;

  /** The shown problems by field path (first message of each). Form-level problems are not included. */
  errors(): Readonly<Record<string, string>>;
  /** Every shown problem, with its path (`""` for the form as a whole). */
  issues(): readonly FormIssue[];
  /** Problems that belong to the form as a whole, not to a field. */
  formErrors(): readonly FieldIssue[];
  /** Paths of the fields that lost focus. */
  touchedFields(): readonly string[];
  /**
   * Paths of the leaf fields whose value differs from its default, and of the arrays and objects
   * whose shape differs (rows moved, added or removed; a key of the defaults removed). It is empty
   * exactly when `isDirty()` is false: a list that equals its defaults again names no path, whatever
   * order its rows went through. A row added after the defaults is compared with the default at its
   * position, so re-adding a removed row with the default's value is clean.
   */
  dirtyFields(): readonly string[];

  /**
   * True when no problem exists (shown or not) and the form can be submitted: a schema that
   * requires a disabled field (left out of the data) counts as a problem.
   *
   * From the first render it follows the schema and `validate` rule when they answer
   * synchronously. When one answers asynchronously, nothing can be known yet, so it is `false`
   * until the first answer arrives (never a false "valid"). Field validators run on an edit, a
   * blur, `trigger()` or a submit (they may call a server), so a field never edited counts as
   * valid until then; `await form.trigger()` makes the answer exact.
   */
  isValid(): boolean;
  /** True when any value differs from its default. */
  isDirty(): boolean;
  /** True once any field lost focus or a submit was attempted (a submit marks every field touched). */
  isTouched(): boolean;
  /** True while `onSubmit` (or the validation before it) is running. */
  isSubmitting(): boolean;
  /** True while an asynchronous validator is running. */
  isValidating(): boolean;
  /** True once a submit was attempted. */
  isSubmitted(): boolean;
  /** True when the last submit finished without error. */
  isSubmitSuccessful(): boolean;
  /** True when the form is disabled. */
  isDisabled(): boolean;
  /** True while asynchronous `defaultValues` are loading. */
  isLoading(): boolean;
  /** The error the asynchronous `defaultValues` threw, or `undefined`. */
  loadError(): unknown;
  /**
   * The state of the form as getters, for subscriptions that follow only what they read. Reading
   * `formState.isDirty` in an effect reruns it for changes of dirtiness, not for problems.
   */
  readonly formState: FormStateView;
  /** How many submits were attempted. */
  submitCount(): number;
  /** The error `onSubmit` threw (or the reason a submit could not start, such as a required disabled field), or `undefined`. */
  submitError(): SubmitErrorState | undefined;

  /** Writes one value (see {@link FieldApi.setValue}). */
  setValue<P extends Path<TInput>>(
    path: P,
    value: PathValue<TInput, P> | ((previous: PathValue<TInput, P>) => PathValue<TInput, P>),
    options?: SetValueOptions,
  ): void;
  /** Merges values into the form (objects merge, arrays and leaves replace) as one change with one validation pass. */
  setValues(values: DefaultValues<TInput>, options?: SetValueOptions): void;
  /** A plain copy of all values, or of one path. Does not subscribe. */
  getValues(): TInput;
  /** A plain copy of the value at `path`. Does not subscribe. */
  getValues<P extends Path<TInput>>(path: P): PathValue<TInput, P>;
  /** An accessor of one value for use in effects and JSX. */
  watch<P extends Path<TInput>>(path: P): Accessor<PathValue<TInput, P>>;
  /** An accessor of a plain copy of all values; it reruns for any change. */
  watch(): Accessor<TInput>;

  /** Validates now, ignoring `validateOn`. All fields, or the given paths (and what is below them). Resolves to whether they are valid. */
  trigger(paths?: string | readonly string[]): Promise<boolean>;
  /** Shows a problem on a field (`""` for the form as a whole), of type `"manual"` unless the issue names one. */
  setError(path: string, error: IssueInput | readonly IssueInput[]): void;
  /**
   * Hides problems: all, or those at and below the given paths. Problems set by hand or by the
   * server are removed; the schema's and validators' come back at the next validation that shows them.
   */
  clearErrors(paths?: string | readonly string[]): void;
  /**
   * Restores the default values (or adopts `values` as the new defaults) and clears all state.
   * Work in flight (a submit, validators) is canceled. `options` keeps parts of the state (see
   * {@link ResetOptions}).
   */
  reset(values?: DefaultValues<TInput>, options?: ResetOptions): void;
  /** The state of one field, as getters (see {@link FieldStateView}). */
  getFieldState(path: string): FieldStateView;
  /** Moves focus to a field and, with `shouldSelect`, selects the text of its inputs. Returns nothing: use {@link FormApi.focus} for the result. */
  setFocus(path: string, options?: { readonly shouldSelect?: boolean | undefined }): void;
  /** Forgets a field: its problems, touched flag and bound controls go, and its value too unless `keepValue` (see {@link UnregisterOptions}). */
  unregister(path: string, options?: UnregisterOptions): void;
  /** Restores one field to its default value and clears its state. */
  resetField(path: string): void;
  /** Moves focus to a field's first connected, enabled control. Returns whether a control got focus. */
  focus(path: string): boolean;
  /** Moves focus to the first control that shows a problem, in document order. False when there is none (always on the server). */
  focusFirstError(): boolean;

  /**
   * Validates, then calls `onSubmit` with the parsed output. Pass it straight to `onSubmit` of a
   * form element; it prevents the default action. Never throws: failures are in the result (see
   * {@link SubmitResult}). When validation stops the submit, `onInvalid` is called.
   *
   * A submit marks every field touched, so problems the submit found show wherever a UI shows
   * problems of touched fields. When the schema requires a field that is disabled (and so left
   * out of the data), the result is `{ ok: false, reason: "invalid", error }` where `error`
   * names the field, and `submitError()` carries the same message.
   */
  handleSubmit(event?: Event): Promise<SubmitResult<TOutput>>;
  /**
   * Like {@link FormApi.handleSubmit} with handlers of your own, for forms with several submit
   * buttons. The form's `onSubmit` and `onInvalid` options are not called.
   */
  handleSubmitWith(
    onValid: (output: TOutput, context: SubmitContext<TInput, TOutput>) => unknown,
    onInvalid?: (issues: readonly FormIssue[]) => void,
  ): (event?: Event) => Promise<SubmitResult<TOutput>>;
  /** Attributes for the `<form>` element (see {@link FormElementProps}). */
  props(): FormElementProps;
  /** Stops pending work and releases the form. Called automatically when the owner is disposed. Calling it again does nothing. */
  dispose(): void;
}

/**
 * The error a failed submit left behind: what `form.submitError()` returns.
 *
 * @example
 * ```ts
 * import { type SubmitErrorState, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({
 *   id: "payment",
 *   defaultValues: { amount: 10 },
 *   onSubmit: () => {
 *     throw new Error("The card was declined.");
 *   },
 * });
 * await form.handleSubmit();
 * const failure: SubmitErrorState | undefined = form.submitError();
 * console.log(failure?.message); // "The card was declined."
 * ```
 * @since 1.0.0
 */
export interface SubmitErrorState {
  /**
   * A message safe to show: the thrown error's message, or `"The form could not be submitted."`
   * when the thrown value is not an `Error` or its message is empty.
   */
  readonly message: string;
  /** What was thrown. */
  readonly cause: unknown;
}
