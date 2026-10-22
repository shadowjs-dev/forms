/**
 * The array helpers of a form (`form.fields`). The `arrays` feature provides them; a form without
 * the feature has none, so the error names the feature to add.
 * @packageDocumentation
 */
import type { ArrayItem, ArrayPath, FieldArrayApi } from "../types";

/**
 * The signature of `form.fields`.
 * @internal
 */
export type FieldsOf<TInput extends object> = <P extends ArrayPath<TInput>>(
  path: P,
) => FieldArrayApi<ArrayItem<TInput, P>>;

/**
 * Returns `form.fields`, or throws when the form was created without the `arrays` feature.
 * @internal
 */
export function fieldsOf<TInput extends object>(form: object): FieldsOf<TInput> {
  const fields: unknown = Reflect.get(form, "fields");
  if (typeof fields !== "function") {
    throw new TypeError("[forms] fields() needs features: [fieldArrays] (@shadow-js/forms/arrays)");
  }
  // Justified cast: the arrays feature installs `fields` with this signature, and `TInput` is the
  // caller's type for the form; nothing at run time can check the type.
  return fields as FieldsOf<TInput>;
}
