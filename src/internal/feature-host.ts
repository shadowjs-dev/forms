/**
 * What `useForm` hands to a feature when it attaches it: the form's core, the form object (the
 * feature adds its members to it) and the field factory (array rows need it).
 * @packageDocumentation
 */
import type { FormOptions } from "../types";
import type { FieldHost } from "./field";
import type { Core } from "./state";

/**
 * The host of one form, passed to every feature once when the form is created.
 * @since 1.0.0
 */
export interface FeatureHost {
  /** The form's state. */
  readonly core: Core;
  /** The form object. A feature adds its members here. */
  readonly form: object;
  /** Creates field handles (a row of an array is a field too). */
  readonly field: FieldHost;
  /**
   * The options a feature reads from the form it attaches to. Only the ones no feature needs the
   * form's value type for: `initialErrors` (submitErrors) is a list or a map of messages.
   */
  readonly options: Pick<FormOptions<object, unknown>, "initialErrors">;
}
