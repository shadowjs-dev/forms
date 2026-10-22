/**
 * Unsaved-changes guard: a predicate for a router's navigation blocker, and the browser's own
 * "leave this page?" prompt.
 * @packageDocumentation
 */
import { untrack, useEffect } from "@shadow-js/core";
import type { FormApi } from "./types";

/**
 * Options of {@link useUnsavedChangesGuard}.
 *
 * @example
 * ```tsx
 * import { useSignal } from "@shadow-js/core";
 * import { useForm, useUnsavedChangesGuard, type UnsavedGuardOptions } from "@shadow-js/forms";
 *
 * export function DraftEditor() {
 *   const form = useForm({ defaultValues: { title: "" } });
 *   const [uploading] = useSignal(false);
 *   const options: UnsavedGuardOptions = { beforeUnload: true, also: uploading };
 *   const guard = useUnsavedChangesGuard(form, options);
 *   return <p>{guard.shouldBlock() ? "Unsaved changes" : "All saved"}</p>;
 * }
 * ```
 * @since 1.0.0
 */
export interface UnsavedGuardOptions {
  /**
   * Ask the browser ("leave this page?") before the tab closes or reloads while
   * {@link UnsavedGuard.shouldBlock} is true. The listener is removed with the component. Default
   * `true`.
   */
  readonly beforeUnload?: boolean | undefined;
  /** An extra reason to block (for example other state outside the form). Read on each check; may be an accessor. */
  readonly also?: (() => boolean) | undefined;
}

/**
 * What {@link useUnsavedChangesGuard} returns.
 *
 * @example
 * ```tsx
 * import { type UnsavedGuard, useForm, useUnsavedChangesGuard } from "@shadow-js/forms";
 *
 * export function NoteEditor() {
 *   const form = useForm({ defaultValues: { note: "" } });
 *   const guard: UnsavedGuard = useUnsavedChangesGuard(form, { beforeUnload: false });
 *   const leave = (): void => {
 *     if (!guard.blocker() || window.confirm("Discard your changes?")) window.location.assign("/notes");
 *   };
 *   return (
 *     <button type="button" onClick={leave}>
 *       Back to notes
 *     </button>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface UnsavedGuard {
  /** True while there are unsaved changes and no submit is running. Reactive. */
  shouldBlock(): boolean;
  /**
   * A blocker predicate: `useBlocker(guard.blocker)` from `@shadow-js/router/blockers` (the
   * `blockers` feature). Takes the
   * transition the router passes and ignores it. Does not subscribe, so it is safe in handlers.
   */
  blocker(transition?: unknown): boolean;
}

/**
 * Guards against losing changes. The form is "unsaved" while it differs from its default values
 * and no submit is in flight; use `resetOnSuccess: "values"` (or `form.reset(values)`) after a save
 * to make the saved values the new baseline.
 *
 * Call it inside a component: the browser prompt is registered in an effect of that component.
 *
 * @param form The form to watch.
 * @param options What else counts, and whether to ask the browser (see {@link UnsavedGuardOptions}).
 *   Default: `{}`.
 * @returns A predicate for the router and a reactive flag for the UI.
 * @example
 * ```tsx
 * import { useForm, useUnsavedChangesGuard } from "@shadow-js/forms";
 * import { useBlocker } from "@shadow-js/router/blockers";
 *
 * export function ProfileEditor() {
 *   const form = useForm({
 *     defaultValues: { name: "" },
 *     resetOnSuccess: "values",
 *     onSubmit: async (values) => {
 *       await fetch("/api/profile", { method: "PUT", body: JSON.stringify(values) });
 *     },
 *   });
 *   const guard = useUnsavedChangesGuard(form);
 *   useBlocker(guard.blocker);
 *   return (
 *     <form {...form.props()}>
 *       <input {...form.field("name").props()} />
 *       <button type="submit" disabled={!guard.shouldBlock()}>
 *         Save
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function useUnsavedChangesGuard<TInput extends object, TOutput = TInput>(
  form: FormApi<TInput, TOutput>,
  options: UnsavedGuardOptions = {},
): UnsavedGuard {
  const shouldBlock = (): boolean =>
    (form.isDirty() || options.also?.() === true) && !form.isSubmitting();
  if (options.beforeUnload !== false) {
    useEffect(() => {
      if (typeof window === "undefined") return undefined;
      const listener = (event: BeforeUnloadEvent): void => {
        if (!untrack(shouldBlock)) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", listener);
      return () => window.removeEventListener("beforeunload", listener);
    });
  }
  return { shouldBlock, blocker: () => untrack(shouldBlock) };
}
