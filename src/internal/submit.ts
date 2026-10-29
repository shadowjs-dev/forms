/**
 * The submit flow: validate everything, focus the first problem, call the handler with the parsed
 * output, and turn what it throws into state.
 * @packageDocumentation
 */
import { batch, untrack } from "@shadow-js/core";
import { leafPaths } from "../data";
import type { FormApi, FormIssue, SubmitContext, SubmitResult } from "../types";
import { clearPushed, resetAll } from "./mutate";
import {
  type Core,
  type ExcludedIssue,
  recOfSegments,
  rootRec,
  setTouchedFlag,
  slotsOf,
} from "./state";
import { effectiveValues, MAX_CHECK_ROUNDS, validate } from "./validate";

/** `Node.DOCUMENT_POSITION_FOLLOWING`, spelled out because `Node` does not exist on the server. */
const DOCUMENT_POSITION_FOLLOWING = 4;

/**
 * Moves focus to the first control (in document order) that shows a problem.
 * @internal
 */
export function focusFirstProblem(core: Core): boolean {
  const first = firstProblemElement(core);
  if (first === undefined) return false;
  first.focus();
  return true;
}

/**
 * The first control (in document order) that is bound to a shown problem, if the form has one
 * in the document.
 * @internal
 */
export function firstProblemElement(core: Core): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  const candidates: Element[] = [];
  for (const key of core.shownKeys) {
    const rec = core.recs.get(key);
    if (rec?.bindings === undefined) continue;
    for (const [element, binding] of rec.bindings) {
      if (element.isConnected && binding.owner.key() === key) candidates.push(element);
    }
  }
  candidates.sort((a, b) => (a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const first = candidates[0];
  return first instanceof HTMLElement ? first : undefined;
}

/**
 * The shown problems of the form with their paths.
 * @internal
 */
export function shownIssues(core: Core, pathOf: (key: string) => string | undefined): FormIssue[] {
  const out: FormIssue[] = [];
  for (const key of core.shownKeys) {
    const rec = core.recs.get(key);
    if (rec === undefined) continue;
    const path = key === "" ? "" : pathOf(key);
    if (path === undefined) continue;
    const shown = rec.slots?.shown.value ?? [];
    const kept = core.opts.criteriaMode === "firstError" ? shown.slice(0, 1) : shown;
    for (const issue of kept) out.push({ ...issue, path });
  }
  return out;
}

/**
 * Marks every field touched: a submit is the user meeting the whole form, so a UI that shows a
 * problem only on touched fields shows the ones the submit found. Leaves of the values plus every
 * record that exists (a path the schema reports without a value, a container).
 */
function touchAll(core: Core): void {
  for (const segments of leafPaths(core.raw()))
    setTouchedFlag(core, recOfSegments(core, segments), true);
  for (const rec of [...core.recs.values()]) {
    if (rec.key !== "") setTouchedFlag(core, rec, true);
  }
}

/** The error of a submit the schema cannot satisfy because it requires disabled fields. */
function excludedError(excluded: readonly ExcludedIssue[]): Error {
  const names = excluded.map((entry) => `"${entry.path}" (${entry.message})`).join(", ");
  const error = new Error(
    __DEV__
      ? `The schema requires ${names}, but ${excluded.length === 1 ? "that field is" : "those fields are"} disabled and left out of the data. Make the field optional in the schema, enable it, or pass \`excludeDisabled: false\`.`
      : `FORMS_DISABLED ${names}`,
  );
  error.name = "DisabledFieldError";
  return error;
}

/**
 * The schema problems that lie under disabled fields, as issues of type `"disabled"`. They are
 * not shown on the (disabled) controls; a failed submit reports them.
 * @internal
 */
export function excludedIssues(core: Core): FormIssue[] {
  return core.excluded.map((entry) => ({
    path: entry.path,
    message: entry.message,
    type: "disabled",
  }));
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The form could not be submitted.";
}

/**
 * Runs one submit. Never throws: the outcome is the result.
 *
 * @param core The form.
 * @param api The public form (handed to the handler).
 * @param event The submit event, if any; its default action is prevented.
 * @param onValid Called with the parsed output.
 * @param onInvalid Called when validation stops the submit.
 * @param pathOf Maps a record key to its current path text.
 * @internal
 */
export async function runSubmit<TInput extends object, TOutput>(
  core: Core,
  api: FormApi<TInput, TOutput>,
  event: Event | undefined,
  onValid: ((output: TOutput, context: SubmitContext<TInput, TOutput>) => unknown) | undefined,
  onInvalid: ((issues: readonly FormIssue[]) => void) | undefined,
  pathOf: (key: string) => string | undefined,
): Promise<SubmitResult<TOutput>> {
  if (event !== undefined && typeof event.preventDefault === "function") event.preventDefault();
  if (core.disposed) return { ok: false, reason: "canceled" };
  if (core.formDisabled()) return { ok: false, reason: "disabled" };
  if (core.submitting.peek()) return { ok: false, reason: "busy" };
  core.submitToken += 1;
  const token = core.submitToken;
  const controller = new AbortController();
  core.submitController = controller;
  batch(() => {
    core.submitting.set(true);
    core.submitted.set(true);
    core.successful.set(false);
    core.submitError.set(undefined);
    core.submitCount.set(core.submitCount.peek() + 1);
    touchAll(core);
    // Problems somebody set by hand or the server sent belong to the previous attempt.
    clearPushed(core, "", ["server", "manual"]);
  });
  try {
    // The checks answer for the values they ran on. A value that changes while they wait makes the
    // answer stale (the check the change started may still be pending), so the checks run again:
    // the decision is about the values that are submitted. Bounded, so a check that keeps writing
    // values cannot hold the submit forever; after the last round the submit decides on what is there.
    let version = core.version.peek();
    let pending = validate(core, { trigger: "submit" });
    for (let round = 1; pending !== undefined; round += 1) {
      await pending;
      if (token !== core.submitToken) return { ok: false, reason: "canceled" };
      if (core.version.peek() === version || round >= MAX_CHECK_ROUNDS) break;
      version = core.version.peek();
      pending = validate(core, { trigger: "submit" });
    }
    if (token !== core.submitToken) return { ok: false, reason: "canceled" };
    const needsOutput = core.opts.resolver !== undefined && core.output === undefined;
    if (core.invalid.size > 0 || needsOutput) {
      const issues = shownIssues(core, pathOf);
      if (core.opts.shouldFocusError) focusFirstProblem(core);
      // The schema needs a field the form leaves out: say so by name instead of stopping silently.
      if (core.invalid.size === 0 && core.excluded.length > 0) {
        const error = excludedError(core.excluded);
        issues.push(...excludedIssues(core));
        batch(() => {
          core.submitError.set({ message: error.message, cause: error });
        });
        untrack(() => onInvalid?.(issues));
        return { ok: false, reason: "invalid", error };
      }
      untrack(() => onInvalid?.(issues));
      return { ok: false, reason: "invalid" };
    }
    // Justified casts: the engine holds the values and the resolver output untyped; `TInput` and
    // `TOutput` are the caller's types for them.
    const input = effectiveValues(core) as TInput;
    const data = (core.opts.resolver === undefined ? input : core.output?.value) as TOutput;
    const result: unknown =
      onValid === undefined
        ? undefined
        : await untrack(() =>
            onValid(data, { signal: controller.signal, form: api, input, event }),
          );
    if (token !== core.submitToken) return { ok: false, reason: "canceled" };
    batch(() => {
      core.successful.set(true);
    });
    const after = core.opts.resetOnSuccess;
    if (after !== false) {
      resetAll(core, after === "values" ? input : undefined);
      batch(() => {
        core.successful.set(true);
      });
    }
    return { ok: true, data, result };
  } catch (error) {
    if (token !== core.submitToken) return { ok: false, reason: "canceled" };
    batch(() => {
      // With the submitErrors feature, the problems the error carries are shown on their fields.
      core.submitErrors?.(error);
      core.submitError.set({ message: messageOf(error), cause: error });
    });
    return { ok: false, reason: "error", error };
  } finally {
    if (token === core.submitToken) {
      batch(() => {
        core.submitting.set(false);
      });
      if (core.submitController === controller) core.submitController = undefined;
    }
  }
}

export { rootRec, slotsOf };
