/**
 * The full preset of `@shadow-js/forms`: `useForm` and the four opt-in features (`fieldArrays`,
 * `asyncValidation`, `submitErrors`, `dates`) in one import. Subpath: `@shadow-js/forms/full`.
 *
 * Use it for a form that needs field arrays, async checks and server errors together. A form that
 * needs only some of them lists those features itself (`features: [fieldArrays]`), so it carries no
 * code for the others; the root entry `@shadow-js/forms` imports none of the features.
 * @packageDocumentation
 */
import { fieldArrays } from "./arrays";
import { asyncValidation } from "./async";
import { dates } from "./dates";
import { submitErrors } from "./submit-errors";
import type { FormFeature } from "./types";

export type { FeatureApi, FormApi, FormFeature, FormOptions, UseFormOptions } from "./types";

export { useForm } from "./use-form";

/**
 * The four opt-in features as one list, in the order `fieldArrays`, `asyncValidation`,
 * `submitErrors`, `dates`. `useForm({ features: full })` gives the form a typed `fields(path)`, async
 * validation with `debounceMs`, and problems thrown by `onSubmit` shown on their fields. The list
 * is frozen at runtime and typed as a readonly tuple of the three feature objects.
 *
 * @example
 * ```ts
 * import { full, useForm } from "@shadow-js/forms/full";
 *
 * const form = useForm({
 *   features: full,
 *   defaultValues: { tags: [{ label: "news" }] },
 * });
 * form.fields("tags").append({ label: "sports" });
 * console.log(form.fields("tags").length()); // 2
 * ```
 * @since 1.0.0
 */
export const full: readonly [
  FormFeature<"arrays">,
  FormFeature<"asyncValidation">,
  FormFeature<"submitErrors">,
  FormFeature<"dates">,
] = Object.freeze([fieldArrays, asyncValidation, submitErrors, dates]);
