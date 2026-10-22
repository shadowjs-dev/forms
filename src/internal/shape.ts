/**
 * Runtime shape checks shared by the internal modules. Internal: no package entry exports this
 * module, and it imports nothing, so the server build can use it.
 * @packageDocumentation
 */

/**
 * True for any non-null object, arrays and store drafts included: the values a form reads by key.
 * @param value Anything.
 * @returns Whether `value` is an object that can hold keyed properties.
 * @internal
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The descriptor of a read-only member: not writable and not configurable (the value of a form or
 * field object that a UI kit may spread but must not change).
 * @param value The member's value.
 * @returns A property descriptor.
 * @internal
 */
export function readOnly(value: unknown): PropertyDescriptor {
  return { value, enumerable: true, writable: false, configurable: false };
}
