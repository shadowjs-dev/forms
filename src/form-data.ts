/**
 * Reading a native form post (`FormData`) into the same typed values the client form holds, so
 * the same schema validates a submit with and without JavaScript. Pure functions with no
 * reactive imports: safe in server code.
 * @packageDocumentation
 */
import { isContainer, leafPaths } from "./data";
import { emptyOf } from "./internal/empty";
import { type FlatIssue, flattenIssues } from "./internal/issues";
import { isPromiseLike } from "./internal/promise";
import { FormPathError, getIn, parsePath, type Segment, setIn } from "./path";
import { issuesToErrors } from "./server-issues";
import type { StandardSchemaV1 } from "./standard-schema";
import type { EmptyValue, IssueInput } from "./types";

/**
 * Options of {@link formDataToValues} and {@link parseFormData}.
 *
 * @example
 * ```ts
 * import { type FormDataOptions, formDataToValues } from "@shadow-js/forms/server";
 *
 * const options: FormDataOptions = {
 *   defaults: { age: 0, newsletter: false, tags: [] as string[] },
 *   emptyValue: "undefined",
 *   maxFields: 50,
 *   onSkip: (name, reason) => console.warn(`skipped ${name}`, reason),
 * };
 * const body = new URLSearchParams("age=42&nickname=&tags=a&tags=b&__proto__.x=1");
 * console.log(formDataToValues(body, options));
 * // { age: 42, nickname: undefined, tags: ["a", "b"], newsletter: false } (and one skipped entry)
 * ```
 * @since 1.0.0
 */
export interface FormDataOptions {
  /**
   * The default values of the form. Their shape guides coercion: a number there makes the field a
   * number (empty or non-numeric text becomes `undefined`), a boolean makes the field a boolean
   * (`""`, `"false"`, `"off"` and `"0"` are `false`) and a missing checkbox `false`, a `Date` makes
   * it a `Date` (invalid text becomes `undefined`), and an array makes the name a list (a missing
   * list of plain values becomes `[]`). Without defaults every value stays text.
   */
  readonly defaults?: object | undefined;
  /** How an empty text field is stored (see `EmptyValue`). Default `"string"`. */
  readonly emptyValue?: EmptyValue | undefined;
  /** Most entries read; more throws a `RangeError` (a guard against abuse). Default 10000. */
  readonly maxFields?: number | undefined;
  /** Called for an entry that was skipped (a malformed or reserved name, or a path that clashes with another), with the `FormPathError` that explains why. */
  readonly onSkip?: ((name: string, reason: unknown) => void) | undefined;
}

/**
 * Name and value pairs as any iterable (an array, or the entries of a `Map`): the input of
 * {@link formDataToValues} and {@link parseFormData} besides `FormData` and `URLSearchParams`.
 * @since 1.0.0
 */
export type FormEntries = Iterable<[string, FormDataEntryValue | string]>;

function entriesOf(data: FormData | URLSearchParams | FormEntries): FormEntries {
  return data instanceof FormData || data instanceof URLSearchParams ? data.entries() : data;
}

function kindOfDefault(shape: unknown): "number" | "boolean" | "date" | "string" | "unknown" {
  if (typeof shape === "number") return "number";
  if (typeof shape === "boolean") return "boolean";
  if (shape instanceof Date) return "date";
  if (typeof shape === "string") return "string";
  return "unknown";
}

function coerce(
  value: FormDataEntryValue | string,
  shape: unknown,
  emptyValue: EmptyValue,
): unknown {
  if (typeof value !== "string") {
    // A file input left empty still posts an empty file.
    return value.size === 0 && value.name === "" ? undefined : value;
  }
  switch (kindOfDefault(shape)) {
    case "number": {
      if (value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case "boolean":
      return !["", "false", "off", "0"].includes(value.toLowerCase());
    case "date": {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    default:
      return value === "" ? emptyOf(emptyValue) : value;
  }
}

/**
 * Turns a form post into nested values. Names are field paths: `email`, `user.emails.0.address`
 * or `lines[0].sku`. Repeated names become a list. Names outside the path grammar (reserved keys
 * such as `__proto__`, odd characters) are skipped, never written. An empty file input (a file
 * with no name and no content) is `undefined`. Pure: safe in server code.
 *
 * @param data A `FormData`, `URLSearchParams` or a list of name/value pairs.
 * @param options Defaults that guide coercion, the empty-text policy and limits (see
 *   {@link FormDataOptions}). Default: `{}`.
 * @returns A plain object shaped like the form's values.
 * @throws RangeError when there are more than `maxFields` entries.
 * @example
 * ```ts
 * import { formDataToValues } from "@shadow-js/forms/server";
 *
 * export async function POST(request: Request): Promise<Response> {
 *   const values = formDataToValues<{ email: string; age: number; agree: boolean }>(
 *     await request.formData(),
 *     { defaults: { email: "", age: 0, agree: false } },
 *   );
 *   return Response.json({ adult: values.age >= 18, agreed: values.agree });
 * }
 * ```
 * @see {@link parseFormData}
 * @since 1.0.0
 */
export function formDataToValues<TInput extends object = Record<string, unknown>>(
  data: FormData | URLSearchParams | FormEntries,
  options?: FormDataOptions,
): TInput;
export function formDataToValues(
  data: FormData | URLSearchParams | FormEntries,
  options: FormDataOptions = {},
): unknown {
  const emptyValue = options.emptyValue ?? "string";
  const limit = options.maxFields ?? 10_000;
  // A group always holds at least one value: the first entry that named it.
  const groups = new Map<
    string,
    {
      segments: Segment[];
      values: [FormDataEntryValue | string, ...Array<FormDataEntryValue | string>];
    }
  >();
  let count = 0;
  for (const [name, value] of entriesOf(data)) {
    count += 1;
    if (count > limit) throw new RangeError(`[forms] more than ${limit} form entries`);
    let segments: Segment[];
    try {
      segments = [...parsePath(name)];
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      options.onSkip?.(name, error);
      continue;
    }
    const key = segments.join(".");
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { segments, values: [value] });
    else group.values.push(value);
  }
  const result: Record<string, unknown> = {};
  const defaults = options.defaults;
  for (const [name, group] of groups) {
    const shape = defaults === undefined ? undefined : getIn(defaults, group.segments);
    let value: unknown;
    if (Array.isArray(shape) || group.values.length > 1) {
      const item = Array.isArray(shape) ? shape[0] : undefined;
      value = group.values.map((entry) => coerce(entry, item, emptyValue));
    } else {
      value = coerce(group.values[0], shape, emptyValue);
    }
    try {
      setIn(result, group.segments, value);
    } catch (error) {
      if (!(error instanceof FormPathError)) throw error;
      options.onSkip?.(name, error);
    }
  }
  if (defaults !== undefined) fillMissing(result, defaults);
  return result;
}

/** Checkboxes post nothing when unchecked: booleans become `false`, lists of primitives become empty. */
function fillMissing(result: Record<string, unknown>, defaults: object): void {
  for (const segments of leafPaths(defaults)) {
    const shape = getIn(defaults, segments);
    if (typeof shape !== "boolean" || getIn(result, segments) !== undefined) continue;
    try {
      setIn(result, segments, false);
    } catch (error) {
      if (!(error instanceof FormPathError)) throw error;
    }
  }
  const stack: Array<{ segments: Segment[]; shape: unknown }> = [{ segments: [], shape: defaults }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (!isContainer(item.shape)) continue;
    if (Array.isArray(item.shape)) {
      if (
        item.segments.length > 0 &&
        item.shape.every((entry) => !isContainer(entry)) &&
        getIn(result, item.segments) === undefined
      ) {
        try {
          setIn(result, item.segments, []);
        } catch (error) {
          if (!(error instanceof FormPathError)) throw error;
        }
      }
      continue;
    }
    for (const key of Object.keys(item.shape)) {
      stack.push({
        segments: [...item.segments, key],
        shape: item.shape[key],
      });
    }
  }
}

/**
 * The outcome of {@link parseFormData}: the schema's output, or the problems and what was posted.
 *
 * @example
 * ```ts
 * import type { ParseFormDataResult } from "@shadow-js/forms/server";
 *
 * function toResponse(result: ParseFormDataResult<{ email: string }, { email: string }>): Response {
 *   if (result.success) return Response.json({ subscribed: result.data.email });
 *   return Response.json({ errors: result.errors, values: result.values }, { status: 422 });
 * }
 *
 * console.log(toResponse({ success: true, data: { email: "ada@example.com" }, values: { email: "ada@example.com" } }).status); // 200
 * ```
 * @since 1.0.0
 */
export type ParseFormDataResult<TInput, TOutput> =
  | {
      /** `true`: the schema accepted the post. */
      readonly success: true;
      /** The schema's output (after its transforms). */
      readonly data: TOutput;
      /** What was posted, as {@link formDataToValues} read it. */
      readonly values: TInput;
    }
  | {
      /** `false`: the schema found problems. */
      readonly success: false;
      /** Problems with their field paths. */
      readonly issues: readonly FlatIssue[];
      /** The same, grouped by path: pass it as `initialErrors` when rendering the page again. */
      readonly errors: Record<string, Exclude<IssueInput, string>[]>;
      /** What was posted, to fill the controls again. */
      readonly values: TInput;
    };

/**
 * Reads a form post and validates it with the same schema the client form uses, so a form works
 * with and without JavaScript. The schema may answer synchronously or with a promise. Issue paths
 * that cannot name a field land on `""`, the form as a whole.
 *
 * @param schema Any Standard Schema (Zod, Valibot, ArkType...).
 * @param data The post.
 * @param options Same as {@link formDataToValues}. Default: `{}`.
 * @returns The parsed output, or the problems and what was posted (see {@link ParseFormDataResult}).
 * @throws RangeError when there are more than `maxFields` entries. What the schema throws is
 *   passed through.
 * @example
 * ```ts
 * import { parseFormData, type StandardSchemaV1 } from "@shadow-js/forms/server";
 *
 * // Any Standard Schema works here (Zod, Valibot, ArkType...); this one is written by hand.
 * const newsletterSchema: StandardSchemaV1<{ email: string }> = {
 *   "~standard": {
 *     version: 1,
 *     vendor: "example",
 *     validate: (value) => {
 *       const email = String((value as { email?: unknown }).email ?? "");
 *       return email.includes("@")
 *         ? { value: { email } }
 *         : { issues: [{ message: "Enter an email", path: ["email"] }] };
 *     },
 *   },
 * };
 *
 * export async function POST(request: Request): Promise<Response> {
 *   const result = await parseFormData(newsletterSchema, await request.formData(), {
 *     defaults: { email: "" },
 *   });
 *   if (!result.success) {
 *     // Render the page again with `initialErrors: result.errors` and `defaultValues: result.values`.
 *     return Response.json({ errors: result.errors, values: result.values }, { status: 422 });
 *   }
 *   return Response.json({ subscribed: result.data.email });
 * }
 * ```
 * @since 1.0.0
 */
export async function parseFormData<TInput extends object, TOutput>(
  schema: StandardSchemaV1<TInput, TOutput>,
  data: FormData | URLSearchParams | FormEntries,
  options: FormDataOptions = {},
): Promise<ParseFormDataResult<TInput, TOutput>> {
  const values = formDataToValues<TInput>(data, options);
  const answer = schema["~standard"].validate(values);
  const result = isPromiseLike(answer) ? await answer : answer;
  if (result.issues !== undefined) {
    const issues = flattenIssues(result.issues);
    return { success: false, issues, errors: issuesToErrors(issues), values };
  }
  return { success: true, data: result.value, values };
}
