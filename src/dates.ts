/**
 * The `dates` feature: the date family of native controls (`date`, `time`, `month`, `week` and
 * `datetime-local`): what each one shows and reads, and the epoch milliseconds or `Date` it stands
 * for. Subpath: `@shadow-js/forms/dates`. Without this feature a form that binds one of these
 * controls throws a `TypeError` that names it, and the calendar code is not bundled.
 * @packageDocumentation
 */

import { dateCodec } from "./internal/dates";
import type { FeatureHost } from "./internal/feature-host";
import type { FormFeature } from "./types";

export type { FormFeature } from "./types";

/**
 * The `dates` feature: install it with `useForm({ features: [dates] })`. A `date` control with
 * `as: "date"` or `as: "number"` reads a `Date` or epoch milliseconds; the `string` form (the default)
 * needs no conversion. The feature adds no members to the form.
 *
 * @example
 * ```ts
 * import { useForm } from "@shadow-js/forms";
 * import { dates } from "@shadow-js/forms/dates";
 *
 * const form = useForm({ features: [dates], defaultValues: { due: "" } });
 * console.log(form.values().due); // ""
 * ```
 * @since 1.0.0
 */
export const dates: FormFeature<"dates"> = {
  name: "dates",
  install(host: FeatureHost): void {
    host.core.dates = { codec: dateCodec };
  },
};
