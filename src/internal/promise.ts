/**
 * Promise checks shared by the engine and the features. Kept apart from `standard-schema.ts` so the
 * minimal form does not import the Standard Schema helpers.
 * @packageDocumentation
 */

/**
 * True for a value with a `then` function (a promise or a thenable).
 * @internal
 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}
