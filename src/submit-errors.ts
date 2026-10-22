/**
 * The `submitErrors` feature: a `FormSubmitError` (or a server function's `issues`) thrown by
 * `onSubmit` is shown on the fields it names, and the first one gets focus; the `initialErrors`
 * option (what a no-JavaScript post produced on the server) is shown from the start. Subpath:
 * `@shadow-js/forms/submit-errors`. Without it the thrown error is the form's `submitError()` only.
 * @packageDocumentation
 */
import { applyIssues } from "./internal/apply-issues";
import { type FlatIssue, pathSegments, pathText, ROOT_PATH, toIssues } from "./internal/issues";
import type { Core } from "./internal/state";
import { firstProblemElement } from "./internal/submit";
import { extractIssues } from "./server-issues";
import type { FormFeature, FormOptions, ServerIssue } from "./types";

export type { FormFeature } from "./types";

/**
 * The `submitErrors` feature: problems carried by what `onSubmit` throws (a `FormSubmitError`'s
 * `fieldErrors`, a server function's `issues`, a `ValidationError` from `@shadow-js/dusk`) are
 * shown on the fields they name, and the first invalid control gets focus unless
 * `shouldFocusError` is `false`. It also enables the `initialErrors` option, shown from the start
 * (for example the problems a no-JavaScript post produced on the server). Pass it in
 * `useForm({ features: [submitErrors] })`.
 *
 * Without it the thrown error is only the form's `submitError()`, and `initialErrors` makes the
 * form throw a `TypeError` that names the feature when it is created.
 *
 * @example
 * ```ts
 * import { FormSubmitError, useForm } from "@shadow-js/forms";
 * import { submitErrors } from "@shadow-js/forms/submit-errors";
 *
 * declare function createAccount(data: { email: string }): Promise<{ readonly ok: boolean }>;
 *
 * const form = useForm({
 *   features: [submitErrors],
 *   defaultValues: { email: "" },
 *   initialErrors: { email: "Already registered" },
 *   onSubmit: async (data) => {
 *     const answer = await createAccount(data);
 *     if (!answer.ok) {
 *       throw new FormSubmitError("Could not save", { fieldErrors: { email: "Try another" } });
 *     }
 *   },
 * });
 * ```
 * @since 1.0.0
 */
export const submitErrors: FormFeature<"submitErrors"> = {
  name: "submitErrors",
  install(host): void {
    const core = host.core;
    core.submitErrors = (error: unknown): void => {
      const issues = extractIssues(error);
      if (issues === undefined) return;
      applyIssues(core, issues, "server");
      if (core.opts.shouldFocusError) revealFirstProblem(core);
    };
    const initial = host.options.initialErrors;
    if (initial !== undefined) applyIssues(core, initialIssues(initial), "server");
  },
};

/**
 * Focuses the first invalid control and scrolls it into view at the nearest edge. A server's
 * problems are often far from where the user is, so the feature scrolls as well (the minimal path
 * only focuses, which is what the browser needs to scroll a control into view on its own).
 */
function revealFirstProblem(core: Core): void {
  const first = firstProblemElement(core);
  if (first === undefined) return;
  first.focus();
  first.scrollIntoView({ block: "nearest" });
}

/** The path text of a server issue's path (a list of keys or `{ key }` steps). */
function issuePath(
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): string {
  // The same rules as the issues of a thrown error: a key that cannot name a field is the form.
  const segments = pathSegments(path);
  return segments === undefined ? ROOT_PATH : pathText(segments);
}

/** The `initialErrors` option: a list of server issues, or a map of path to problems. */
type InitialErrors = NonNullable<FormOptions<object, unknown>["initialErrors"]>;

/**
 * True for the list form of `initialErrors`. A type guard, because `Array.isArray` narrows a
 * readonly array to `any[]`.
 */
function isIssueList(initial: InitialErrors): initial is readonly ServerIssue[] {
  return Array.isArray(initial);
}

/** The `initialErrors` option as issues with path text, ready for `applyIssues`. */
function initialIssues(initial: InitialErrors): FlatIssue[] {
  if (isIssueList(initial)) {
    return initial.map((issue) => ({
      path: issuePath(issue.path),
      message: issue.message,
    }));
  }
  return Object.entries(initial).flatMap(([path, value]) =>
    toIssues(value, "server").map((issue) => ({ path, message: issue.message, type: issue.type })),
  );
}
