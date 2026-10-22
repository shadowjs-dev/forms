/**
 * `bind`: attributes for a native control, from a field handle.
 * @packageDocumentation
 */
import type { ControlKind, ControlTypes, FieldApi, TextControlProps } from "./types";

/**
 * Attributes and handlers for a native control, ready to spread. The same as `field.props()`.
 *
 * Text-like controls (`input`, `textarea`) are the default. Other controls name their kind:
 * `"number"`, `"checkbox"`, `"select"`, `"file"`, `"date"`, or an options object (a radio button
 * needs its `value`).
 *
 * @param field A field handle.
 * @param kindOrOptions A control kind, or its options (see `TextOptions`, `NumberOptions` and the
 *   other control options). Default: the `text` kind.
 * @returns The attribute bag, typed for the kind: the same object `field.props()` returns for the
 *   same kind and options.
 * @throws TypeError for `{ kind: "date", type: "week" }` with an `as` other than `"string"`.
 * @example
 * ```tsx
 * import { bind, useForm } from "@shadow-js/forms";
 *
 * export function MembershipForm() {
 *   const form = useForm({ defaultValues: { name: "", age: 18, plan: "free" } });
 *   const plan = form.field("plan");
 *   return (
 *     <form {...form.props()}>
 *       <input {...bind(form.field("name"))} />
 *       <input {...bind(form.field("age"), "number")} />
 *       <label>
 *         <input {...bind(plan, { kind: "radio", value: "free" })} /> Free
 *       </label>
 *       <label>
 *         <input {...bind(plan, { kind: "radio", value: "pro" })} /> Pro
 *       </label>
 *     </form>
 *   );
 * }
 * ```
 * @see {@link FieldApi.props}
 * @since 1.0.0
 */
export function bind<V>(field: FieldApi<V>): TextControlProps;
export function bind<V, K extends Exclude<ControlKind, "radio">>(
  field: FieldApi<V>,
  kind: K,
): ControlTypes[K]["props"];
export function bind<V, K extends ControlKind>(
  field: FieldApi<V>,
  options: ControlTypes[K]["options"] & { readonly kind?: K },
): ControlTypes[K]["props"];
export function bind<V>(
  field: FieldApi<V>,
  kindOrOptions?:
    | ControlKind
    | (ControlTypes[ControlKind]["options"] & { readonly kind?: ControlKind }),
): ControlTypes[ControlKind]["props"] {
  if (typeof kindOrOptions === "string") {
    // Justified cast: a bare kind is the options of that kind (every kind but radio needs nothing
    // more); TypeScript cannot pick the union member for a kind that is only known at run time.
    return field.props({ kind: kindOrOptions } as ControlTypes[ControlKind]["options"] & {
      readonly kind?: ControlKind;
    });
  }
  return field.props(kindOrOptions);
}
