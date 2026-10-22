/**
 * Sizes of a form's internal registers, for the test suite: it proves that removed rows leave
 * nothing behind. Not part of the public API (it is not exported from the package entries).
 * @packageDocumentation
 */
import type { Core } from "./state";

/** The form object to its core. Weak, so a form can be collected. */
const cores: WeakMap<object, Core> = new WeakMap();

/**
 * Remembers the core of a form.
 * @internal
 */
export function track(form: object, core: Core): void {
  cores.set(form, core);
}

/**
 * How much a form holds.
 * @internal
 */
export interface Sizes {
  readonly recs: number;
  readonly rows: number;
  readonly rowRecs: number;
  readonly rowArrays: number;
  readonly invalid: number;
  readonly shown: number;
  readonly bound: number;
  readonly handleValidators: number;
}

/**
 * The register sizes of `form`, or `undefined` for an object that is not a form.
 * @internal
 */
export function sizesOf(form: object): Sizes | undefined {
  const core = cores.get(form);
  if (core === undefined) return undefined;
  return {
    recs: core.recs.size,
    rows: core.rows.size,
    rowRecs: core.rowRecs.size,
    rowArrays: core.rowArrays.size,
    invalid: core.invalid.size,
    shown: core.shownKeys.size,
    bound: core.boundKeys.size,
    handleValidators: core.handleValidators.size,
  };
}
