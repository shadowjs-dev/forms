/**
 * Plain-data helpers: cloning, structural equality and leaf walks. Every traversal whose depth
 * comes from user data is iterative, so deep or cyclic data cannot overflow the call stack.
 * Internal: no package entry exports this module.
 * @packageDocumentation
 */
import { isRecord } from "./internal/shape";
import { FormPathError, isReservedKey, type Segment } from "./path";

/**
 * Plain objects and arrays: the containers a form walks into. Everything else (strings, dates,
 * files, class instances) is a leaf.
 * @param value Anything.
 * @returns Whether `value` is a plain object or an array.
 * @internal
 */
export function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The own property `key` of `container`, or `undefined` (inherited properties are not data). */
function ownValue(container: unknown, key: string): unknown {
  if (!isRecord(container)) return undefined;
  if (!Object.hasOwn(container, key)) return undefined;
  return container[key];
}

/**
 * A deep copy of plain data. Files, dates and other class instances are shared, not copied; sparse
 * arrays become dense (holes read as `undefined`); shared and cyclic references are preserved.
 * Reserved keys throw: data that carries `__proto__` is refused, never silently merged.
 *
 * @param value Plain data or a leaf.
 * @returns An independent copy.
 * @throws FormPathError for a reserved key in the data.
 * @internal
 */
export function plainClone<T>(value: T): T;
export function plainClone(value: unknown): unknown {
  if (!isContainer(value)) return value;
  const copies = new Map<object, object>();
  const root: object = Array.isArray(value) ? new Array<unknown>(value.length) : {};
  copies.set(value, root);
  const pending: Array<[object, object]> = [[value, root]];
  for (let job = pending.pop(); job !== undefined; job = pending.pop()) {
    const [source, target] = job;
    const keys = Array.isArray(source)
      ? Array.from({ length: source.length }, (_, index) => String(index))
      : Object.keys(source);
    for (const key of keys) {
      if (isReservedKey(key))
        throw new FormPathError(__DEV__ ? `"${key}" is a reserved key in data` : "FORMS_KEY_4");
      const child = ownValue(source, key);
      // The copy is an array or a plain object, written to by key.
      const into = target as Record<string, unknown>;
      if (!isContainer(child)) {
        into[key] = child;
        continue;
      }
      let copy = copies.get(child);
      if (copy === undefined) {
        copy = Array.isArray(child) ? new Array<unknown>(child.length) : {};
        copies.set(child, copy);
        pending.push([child, copy]);
      }
      into[key] = copy;
    }
  }
  return root;
}

/** Leaves compared by value rather than identity. */
function leafEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return false;
}

/**
 * Structural equality for form data: plain containers are compared by content (key order does
 * not matter, array order does), dates by time, `NaN` equals `NaN`, everything else (files,
 * class instances) by identity. Iterative; a pair of cyclic structures terminates.
 *
 * @param a First value.
 * @param b Second value.
 * @returns Whether the two hold the same data.
 * @internal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  const seen = new Map<object, Set<object>>();
  const stack: Array<[unknown, unknown]> = [[a, b]];
  for (let pair = stack.pop(); pair !== undefined; pair = stack.pop()) {
    const [x, y] = pair;
    const containerX = isContainer(x);
    const containerY = isContainer(y);
    if (!containerX || !containerY) {
      if (containerX !== containerY || !leafEqual(x, y)) return false;
      continue;
    }
    if (x === y) continue;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    let known = seen.get(x);
    if (known === undefined) {
      known = new Set();
      seen.set(x, known);
    }
    if (known.has(y)) continue;
    known.add(y);
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let index = 0; index < x.length; index += 1) stack.push([x[index], y[index]]);
      continue;
    }
    const keysX = Object.keys(x);
    // A key holding `undefined` is the same as a missing key: forms treat them alike.
    const keysY = Object.keys(y);
    for (const key of keysX) stack.push([ownValue(x, key), ownValue(y, key)]);
    for (const key of keysY) if (!Object.hasOwn(x, key)) stack.push([undefined, ownValue(y, key)]);
  }
  return true;
}

/**
 * Every leaf below `root`, as segments. Containers are not listed; an empty array or object has
 * no leaves. Iterative, so the depth of the data does not matter.
 *
 * @param root Plain data.
 * @param prefix Segments of `root` itself, prepended to each result.
 * @returns One segment list per leaf, in document order.
 * @internal
 */
export function leafPaths(root: unknown, prefix: readonly Segment[] = []): Segment[][] {
  const out: Segment[][] = [];
  const stack: Array<{ segments: Segment[]; value: unknown }> = [
    { segments: [...prefix], value: root },
  ];
  const visited = new Set<object>();
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (!isContainer(item.value)) {
      if (item.segments.length > 0) out.push(item.segments);
      continue;
    }
    if (visited.has(item.value)) continue;
    visited.add(item.value);
    const keys: Array<string | number> = Array.isArray(item.value)
      ? Array.from({ length: item.value.length }, (_, index) => index)
      : Object.keys(item.value);
    // Pushed in reverse so the stack pops them in document order.
    for (const key of keys.reverse()) {
      stack.push({
        segments: [...item.segments, key],
        value: ownValue(item.value, String(key)),
      });
    }
  }
  return out;
}
