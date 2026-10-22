/**
 * Server integration: mapping what a server answers onto fields, and running a server function as
 * the submit handler. Nothing here imports `@shadow-js/dusk`: the types are structural, so any
 * function that takes the parsed input and returns a promise fits.
 * @packageDocumentation
 */
import { extractIssues } from "./server-issues";
import type { FormApi, IssueInput } from "./types";

/**
 * The error to throw from `onSubmit` to report a failed submit, optionally with problems for
 * fields. The submit ends with `{ ok: false, reason: "error" }` and `form.submitError()` holds the
 * message (a generic one when `message` is empty). With the `submitErrors` feature, each entry of
 * `fieldErrors` is also shown on the field it names, and the first invalid control gets focus
 * unless `shouldFocusError` is `false`; without the feature only `submitError()` reports it.
 *
 * @example
 * ```ts
 * import { FormSubmitError, useForm } from "@shadow-js/forms";
 * import { submitErrors } from "@shadow-js/forms/submit-errors";
 *
 * declare function register(email: string): Promise<{ readonly taken: boolean }>;
 *
 * const form = useForm({
 *   features: [submitErrors],
 *   defaultValues: { email: "" },
 *   onSubmit: async (data) => {
 *     const answer = await register(data.email);
 *     if (answer.taken) {
 *       throw new FormSubmitError("Could not register", {
 *         fieldErrors: { email: "Already registered" },
 *       });
 *     }
 *   },
 * });
 * ```
 * @see {@link applyServerErrors}
 * @since 1.0.0
 */
export class FormSubmitError extends Error {
  /**
   * Problems by field path, as path text (`"tags.0.label"` or `"tags[0].label"`); `""` is the form
   * as a whole, and text that does not parse as a path lands there too. A value is one message or
   * a list of them. Empty (`{}`) when the constructor was given none.
   */
  readonly fieldErrors: Readonly<Record<string, string | readonly string[]>>;

  /**
   * Creates the error. Its `name` is `"FormSubmitError"`.
   * @param message The message `form.submitError()` reports.
   * @param options `fieldErrors`: problems by field path (default `{}`).
   */
  constructor(
    message: string,
    options: { readonly fieldErrors?: Readonly<Record<string, string | readonly string[]>> } = {},
  ) {
    super(message);
    this.name = "FormSubmitError";
    this.fieldErrors = options.fieldErrors ?? {};
  }
}

/**
 * What {@link applyServerErrors} did: whether it found problems in its source, and where it put
 * them.
 * @example
 * ```ts
 * import { applyServerErrors, useForm } from "@shadow-js/forms";
 *
 * const form = useForm({ defaultValues: { email: "" } });
 * const result = applyServerErrors(form, { email: "Taken" });
 * console.log(result.applied, result.paths); // true ["email"]
 * ```
 * @since 1.0.0
 */
export interface ApplyServerErrorsResult {
  /** `true` when the source held at least one problem and it was shown; `false` otherwise. */
  readonly applied: boolean;
  /**
   * The paths that received a problem, as canonical text, each once, in the order they first
   * appear in the source (`""` is the form as a whole). Empty when `applied` is `false`.
   */
  readonly paths: readonly string[];
}

/**
 * Shows server-side problems on the fields they name. The source can be Standard Schema issues,
 * the `issues` of a `ValidationError` from `@shadow-js/dusk` (also when carried under `data`), a
 * `{ fieldErrors }` object, or a plain map of path to message(s) (see `extractIssues`). Problems
 * for paths no control is bound to are kept too: the field shows them when it appears. Problems
 * without a path go to `form.formErrors()`.
 *
 * Each path's problems replace the ones set earlier by hand at that path (as `form.setError`
 * does) and count as type `"server"` unless the source names a type. They stay until the field's
 * value changes, `form.clearErrors` removes them, the form is reset (without `keepErrors`), or the
 * next submit starts.
 *
 * @param form The form to show the problems on.
 * @param source Issues, a thrown error, a response body or a map. Anything else (a network error,
 * `undefined`) is not a problem list, and the result says so.
 * @param options `focus: false` leaves focus alone. By default (`focus` omitted or `true`) the
 * first invalid control gets focus, in document order, when a `document` exists.
 * @returns Whether problems were found, and the paths that received them.
 * @example
 * ```ts
 * import { applyServerErrors, useForm } from "@shadow-js/forms";
 *
 * declare function createUser(values: { email: string }): Promise<void>;
 *
 * const form = useForm({
 *   defaultValues: { email: "" },
 *   onSubmit: async (data, context) => {
 *     try {
 *       await createUser(data);
 *     } catch (error) {
 *       if (!applyServerErrors(context.form, error).applied) throw error;
 *     }
 *   },
 * });
 * ```
 * @see {@link FormSubmitError}
 * @see {@link submitWith}
 * @since 1.0.0
 */
export function applyServerErrors<TInput extends object, TOutput>(
  form: FormApi<TInput, TOutput>,
  source: unknown,
  options: { readonly focus?: boolean } = {},
): ApplyServerErrorsResult {
  const issues = extractIssues(source);
  if (issues === undefined || issues.length === 0) return { applied: false, paths: [] };
  const grouped = new Map<string, IssueInput[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.path) ?? [];
    list.push({ message: issue.message, type: issue.type ?? "server" });
    grouped.set(issue.path, list);
  }
  for (const [path, list] of grouped) form.setError(path, list);
  if (options.focus !== false && typeof document !== "undefined") form.focusFirstError();
  return { applied: true, paths: [...grouped.keys()] };
}

/**
 * A function that takes the parsed form output and returns a promise: a server function from
 * `@shadow-js/dusk`, a `fetch` wrapper, an RPC client method. {@link submitWith} calls it with the
 * output and `{ signal }`, the signal of the submit.
 * @example
 * ```ts
 * import type { ServerAction } from "@shadow-js/forms";
 *
 * const createPost: ServerAction<{ title: string }, { id: string }> = async (input, options) => {
 *   const response = await fetch("/api/posts", {
 *     method: "POST",
 *     body: JSON.stringify(input),
 *     signal: options?.signal ?? null,
 *   });
 *   return (await response.json()) as { id: string };
 * };
 * console.log(typeof createPost);
 * ```
 * @since 1.0.0
 */
export type ServerAction<TInput, TResult> = (
  input: TInput,
  options?: { readonly signal?: AbortSignal },
) => PromiseLike<TResult>;

/**
 * Turns a server function into the `onSubmit` of a form. The function receives the parsed output
 * and, as its second argument, `{ signal }`: the signal of the submit, which aborts when the form
 * is reset or disposed while the call is in flight. A `@shadow-js/dusk` stub honors it (the
 * request is canceled); any other function can pass it to `fetch`. When the function throws or
 * rejects, the submit counts as failed (`reason: "error"`); with the `submitErrors` feature, the
 * problems the error carries (a `ValidationError`, `{ issues }`, a {@link FormSubmitError}) are
 * shown on the fields they name.
 *
 * `after` runs only when the submit is still current: if the signal aborted while the call was
 * running (the form was reset or disposed), the result is returned to the submit flow, which
 * reports `{ ok: false, reason: "canceled" }`, and `after` is not called.
 *
 * @param action The server function.
 * @param after Called with the result and the submit context after a successful call that was
 * not canceled. Optional.
 * @returns A function to pass as `onSubmit`. It resolves to the result of `action`, which a
 * successful submit reports as `result`.
 * @example
 * ```ts
 * import { submitWith, useForm } from "@shadow-js/forms";
 * import { submitErrors } from "@shadow-js/forms/submit-errors";
 *
 * declare function createPost(
 *   input: { title: string },
 *   options?: { readonly signal?: AbortSignal },
 * ): Promise<{ id: string }>;
 * declare function navigate(to: string): void;
 *
 * const form = useForm({
 *   features: [submitErrors],
 *   defaultValues: { title: "" },
 *   onSubmit: submitWith(createPost, (post) => navigate(`/posts/${post.id}`)),
 * });
 * ```
 * @see {@link ServerAction}
 * @see {@link applyServerErrors}
 * @since 1.0.0
 */
export function submitWith<
  TOutput,
  TResult,
  TContext extends { readonly signal: AbortSignal } = { readonly signal: AbortSignal },
>(
  action: ServerAction<TOutput, TResult>,
  after?: (result: TResult, context: TContext) => void,
): (output: TOutput, context: TContext) => Promise<TResult> {
  return async (output, context) => {
    const result = await action(output, { signal: context.signal });
    // A reset or an unmount aborted the submit while the call was running: the result belongs to a
    // form state that no longer exists, so it must not navigate, toast or write anything.
    if (!context.signal.aborted) after?.(result, context);
    return result;
  };
}
