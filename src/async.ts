/**
 * The `asyncValidation` feature: promised answers from a resolver, a `validate` rule or a field
 * validator; the `debounceMs` quiet period; cancellation of superseded checks; and `isValidating()`.
 * Subpath: `@shadow-js/forms/async`. Without it a promise is refused as a problem, and `debounceMs`
 * throws when the form is created.
 * @packageDocumentation
 */
import { createAsyncPlug } from "./internal/async";
import type { FormFeature } from "./types";

export type { FormFeature } from "./types";

/**
 * The `asyncValidation` feature: lets a resolver, the `validate` rule or a field validator answer
 * with a promise, enables `debounceMs` (the quiet period before a check re-runs after a change),
 * and cancels a check that a newer one supersedes. `form.isValidating()` is `true` while such a
 * check is pending. Pass it in `useForm({ features: [asyncValidation] })`.
 *
 * Without it a promised answer is refused and shown as a problem that names the feature, and a
 * `debounceMs` greater than 0 (in the form options, a field validator or a validator map entry)
 * makes the form throw a `TypeError` when it is created or when the field is registered.
 *
 * @example
 * ```ts
 * import { useForm } from "@shadow-js/forms";
 * import { asyncValidation } from "@shadow-js/forms/async";
 *
 * declare function isTaken(code: string): Promise<boolean>;
 *
 * const form = useForm({ features: [asyncValidation], defaultValues: { code: "" } });
 * form.field("code", {
 *   validate: {
 *     validate: async (code) => ((await isTaken(code)) ? "Taken" : undefined),
 *     debounceMs: 300,
 *   },
 * });
 * ```
 * @since 1.0.0
 */
export const asyncValidation: FormFeature<"asyncValidation"> = {
  name: "asyncValidation",
  install(host): void {
    host.core.async = createAsyncPlug(host.core);
  },
};
