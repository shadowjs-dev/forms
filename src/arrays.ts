/**
 * The `arrays` feature: field arrays for `form.fields(path)`, `useFieldArray` and `<FieldArray>`.
 * A row keeps its state (errors, touched flags, controls and their focus) when the rows around it
 * move. Subpath: `@shadow-js/forms/arrays`. Without this feature a form has no `fields`, and its
 * array items are plain index keys.
 * @packageDocumentation
 */

import type { ArrayImpl } from "./internal/array";
import { createArray } from "./internal/array";
import { remember } from "./internal/cache";
import type { FeatureHost } from "./internal/feature-host";
import { track } from "./internal/inspect";
import { staticLoc } from "./internal/loc";
import { createRowsPlug } from "./internal/rows";
import { formatPath, parsePath } from "./path";
import type { FormFeature } from "./types";

export type { FormFeature } from "./types";

/**
 * The `arrays` feature: field arrays whose rows keep their state (problems, touched flags,
 * controls and focus) when the rows around them move. Pass it in
 * `useForm({ features: [fieldArrays] })`; the form then has `fields(path)`, which `useFieldArray`
 * and `<FieldArray>` use too. Without it a form has no `fields`, `useFieldArray` and `<FieldArray>`
 * throw a `TypeError` that names the feature, and array items are plain index paths.
 *
 * Calls of `form.fields` with the same path return the same handle; a path that does not parse
 * throws a `FormPathError`.
 *
 * @example
 * ```ts
 * import { useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * const form = useForm({
 *   features: [fieldArrays],
 *   defaultValues: { tags: [{ label: "news" }] },
 * });
 * const tags = form.fields("tags");
 * tags.append({ label: "sports" });
 * console.log(tags.length()); // 2
 * ```
 * @since 1.0.0
 */
export const fieldArrays: FormFeature<"arrays"> = {
  name: "arrays",
  install(host: FeatureHost): void {
    const core = host.core;
    core.arrays = createRowsPlug(core);
    const handles = new Map<string, ArrayImpl>();
    const fields = (path: string): ArrayImpl => {
      const segments = [...parsePath(path)];
      return remember(handles, formatPath(segments), () =>
        createArray(host.field, staticLoc(core, segments)),
      );
    };
    Object.defineProperty(host.form, "fields", { value: fields, enumerable: true });
    // The register sizes the test suite reads (`sizesOf`) are about rows and records, so they are
    // recorded for the forms that have rows.
    track(host.form, core);
  },
};
