/**
 * Field paths: `"email"`, `"user.emails.0.address"`, `"matrix.1.0"`.
 *
 * Grammar (strict, so that every path has exactly one canonical spelling):
 *
 * - a key is one or more characters other than `.`, `[`, `]` and control characters;
 * - a segment made only of digits without a leading zero (`0`, `12`) is an array index; `"007"` is a key;
 * - the bracket spelling `lines[2].sku` is accepted and normalized to `lines.2.sku`;
 * - the keys `__proto__`, `constructor` and `prototype` are rejected everywhere: they would reach
 *   `Object.prototype` if they were ever written.
 *
 * Patterns (used to attach validators to many fields) may contain `*` (or the bracket spelling
 * `[]`), which matches any single segment.
 *
 * @packageDocumentation
 */
import { isRecord } from "./internal/shape";

/**
 * One step of a parsed path: an object key (a string) or an array index (a non-negative safe
 * integer). {@link parsePath} produces them and {@link formatPath} spells them back.
 *
 * @example
 * ```ts
 * import { parsePath, type Segment } from "@shadow-js/forms";
 *
 * const segments: readonly Segment[] = parsePath("lines[2].sku");
 * console.log(segments); // ["lines", 2, "sku"]
 * ```
 * @see {@link parsePath}
 * @since 1.0.0
 */
export type Segment = string | number;

/**
 * The marker {@link parsePattern} puts at each wildcard step (`*` or `[]`) of a pattern. A
 * {@link matchesPattern} step that holds it matches any single segment. It is a unique symbol, so
 * no key or index can be mistaken for it.
 *
 * @example
 * ```ts
 * import { parsePattern } from "@shadow-js/forms";
 *
 * const [, wildcard] = parsePattern("lines.*.sku");
 * console.log(typeof wildcard); // "symbol"
 * ```
 * @see {@link PatternSegment}
 * @since 1.0.0
 */
export const ANY: unique symbol = Symbol("any-segment");

/**
 * One step of a compiled pattern: a {@link Segment}, or {@link ANY} where the pattern had `*` or
 * `[]`. {@link parsePattern} returns a list of them and {@link matchesPattern} reads it.
 *
 * @example
 * ```ts
 * import { matchesPattern, parsePattern } from "@shadow-js/forms";
 *
 * const pattern = parsePattern("lines[].sku");
 * console.log(matchesPattern(pattern, ["lines", 4, "sku"])); // true
 * ```
 * @since 1.0.0
 */
export type PatternSegment = Segment | typeof ANY;

/**
 * The most `undefined` slots a single write may add to an array: 1000. Writing `items.5.name` into
 * an empty list fills `0..4` so the array stays dense; an index more than `MAX_FILL` past the
 * current end (a typo such as `items.1000000000.name`) makes {@link setIn} throw a
 * {@link FormPathError} instead of allocating the slots, and nothing is written.
 *
 * @example
 * ```ts
 * import { FormPathError, MAX_FILL, setIn } from "@shadow-js/forms";
 *
 * const data: { items: unknown[] } = { items: [] };
 * setIn(data, ["items", MAX_FILL], "last"); // fills items 0 to 999 with undefined
 * try {
 *   setIn(data, ["items", 5000], "too far");
 * } catch (error) {
 *   console.log(error instanceof FormPathError); // true: 5000 is more than 1000 past the end
 * }
 * ```
 * @since 1.0.0
 */
export const MAX_FILL = 1000;

/**
 * The error for a malformed path, a reserved key (`__proto__`, `constructor`, `prototype`) and a
 * write {@link setIn} cannot make. It is a `TypeError` whose `name` is `"FormPathError"`, so
 * `catch` blocks can tell it apart with `instanceof`.
 *
 * @example
 * ```ts
 * import { FormPathError, parsePath } from "@shadow-js/forms";
 *
 * try {
 *   parsePath("user..email");
 * } catch (error) {
 *   if (error instanceof FormPathError) console.log(error.message); // unexpected "." in "user..email"
 * }
 * ```
 * @since 1.0.0
 */
export class FormPathError extends TypeError {
  /**
   * Creates the error. The library throws it; application code rarely constructs one.
   * @param message What is wrong with the path, naming the path.
   */
  constructor(message: string) {
    super(message);
    this.name = "FormPathError";
  }
}

const RESERVED: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const INDEX_DIGITS = /^(?:0|[1-9][0-9]*)$/;

/**
 * True for the keys the library refuses everywhere (`__proto__`, `constructor`, `prototype`).
 * Not exported from a package entry.
 * @param key A key.
 * @returns Whether the key is reserved.
 * @internal
 */
export function isReservedKey(key: string): boolean {
  return RESERVED.has(key);
}

/** Checks one key against the grammar and returns it. */
function checkKey(key: string, where: string): string {
  if (key.length === 0) throw new FormPathError(__DEV__ ? `empty key in ${where}` : "FORMS_KEY_3");
  if (RESERVED.has(key))
    throw new FormPathError(__DEV__ ? `"${key}" is a reserved key` : "FORMS_KEY_4");
  // Code units below a space are control characters (the grammar refuses them).
  if ([...key].some((ch) => ch < " ")) {
    throw new FormPathError(
      __DEV__ ? `control characters are not allowed in ${where}` : "FORMS_KEY_2",
    );
  }
  return key;
}

function isIndex(text: string): boolean {
  return INDEX_DIGITS.test(text) && Number.isSafeInteger(Number(text));
}

/**
 * Parses a field path into segments. Dotted and bracket spellings give the same result:
 * `"lines[2].sku"` and `"lines.2.sku"` are both `["lines", 2, "sku"]`. A step of digits without a
 * leading zero is an index (a number); any other step, `"007"` included, is a key (a string).
 *
 * @param path The path text.
 * @param allowAny Accept `*` and `[]` as {@link ANY} (patterns only; use {@link parsePattern}).
 *   Without it, `*` is an ordinary key and `[]` is an error.
 * @returns The segments, in order.
 * @throws FormPathError when `path` is not a string or is empty, has an empty step (`"a..b"`,
 *   `".a"`, `"a."`), an unclosed or stray bracket, a bracket that does not hold an index
 *   (`"a[01]"`, `"a[b]"`), a reserved key or a control character.
 * @example
 * ```ts
 * import { parsePath } from "@shadow-js/forms";
 *
 * console.log(parsePath("lines[2].sku")); // ["lines", 2, "sku"]
 * console.log(parsePath("user.emails.0.address")); // ["user", "emails", 0, "address"]
 * console.log(parsePath("codes.007")); // ["codes", "007"]
 * ```
 * @see {@link formatPath}
 * @since 1.0.0
 */
export function parsePath(path: string): readonly Segment[];
export function parsePath(path: string, allowAny: true): readonly PatternSegment[];
export function parsePath(path: string, allowAny = false): readonly PatternSegment[] {
  if (typeof path !== "string" || path.length === 0) {
    throw new FormPathError(__DEV__ ? "a path must be a non-empty string" : "FORMS_PATH_1");
  }
  const bad = (problem: string): never => {
    throw new FormPathError(__DEV__ ? `${problem} in "${path}"` : "FORMS_PATH_7");
  };
  const out: PatternSegment[] = [];
  const n = path.length;
  let i = 0;
  // `after` is what the grammar allows next: a key, a dot-key, or the end.
  let after: "start" | "segment" | "dot" = "start";
  while (i < n) {
    const ch = path.charAt(i);
    if (ch === "[") {
      if (after === "dot") bad(__DEV__ ? 'expected a key after "."' : "");
      const close = path.indexOf("]", i);
      if (close === -1) bad(__DEV__ ? 'unclosed "["' : "");
      const digits = path.slice(i + 1, close);
      if (digits === "" && allowAny) out.push(ANY);
      else if (isIndex(digits)) out.push(Number(digits));
      else bad(__DEV__ ? `"[${digits}]" is not an array index` : "");
      i = close + 1;
      after = "segment";
      continue;
    }
    if (ch === ".") {
      if (after !== "segment") bad(__DEV__ ? 'unexpected "."' : "");
      after = "dot";
      i += 1;
      continue;
    }
    if (ch === "]") bad(__DEV__ ? 'unexpected "]"' : "");
    if (after === "segment") bad(__DEV__ ? 'expected "." or "["' : "");
    let end = i;
    while (end < n && !".[]".includes(path.charAt(end))) end += 1;
    const text = path.slice(i, end);
    if (allowAny && text === "*") out.push(ANY);
    else if (isIndex(text)) out.push(Number(text));
    else out.push(checkKey(text, `"${path}"`));
    i = end;
    after = "segment";
  }
  if (after === "dot") bad(__DEV__ ? 'a path cannot end with "."' : "");
  return out;
}

/**
 * Spells segments as canonical path text, steps joined with `.`: the inverse of
 * {@link parsePath}. A digit-only key such as `"2"` is written as is and parses back as the index
 * `2`; both address the same slot of a container.
 *
 * @param segments Segments to spell out, at least one. Keys are checked against the grammar.
 * @returns The path text (`"lines.2.sku"`).
 * @throws FormPathError for an empty list, an index that is negative or not a safe integer, and a
 *   key that is empty, reserved, holds a control character or contains `.`, `[` or `]`.
 * @example
 * ```ts
 * import { formatPath } from "@shadow-js/forms";
 *
 * console.log(formatPath(["lines", 2, "sku"])); // "lines.2.sku"
 * ```
 * @since 1.0.0
 */
export function formatPath(segments: readonly Segment[]): string {
  if (segments.length === 0)
    throw new FormPathError(__DEV__ ? "cannot format an empty path" : "FORMS_PATH_1");
  let text = "";
  for (const [index, segment] of segments.entries()) {
    let part: string;
    if (typeof segment === "number") {
      if (!Number.isSafeInteger(segment) || segment < 0) {
        throw new FormPathError(__DEV__ ? `${segment} is not an array index` : "FORMS_PATH_3");
      }
      part = String(segment);
    } else {
      checkKey(segment, "the path");
      if (/[.[\]]/.test(segment)) {
        throw new FormPathError(
          __DEV__ ? `"${segment}" cannot be a key (no . [ or ])` : "FORMS_KEY_1",
        );
      }
      // A digit-only key parses back as an index; both address the same slot of a container.
      part = segment;
    }
    text += index === 0 ? part : `.${part}`;
  }
  return text;
}

/**
 * Re-spells a path in canonical dotted form, the spelling the form uses for the keys of
 * `errors()`, `touchedFields()` and the other flat maps. Use it to look up a path that may arrive
 * in bracket spelling.
 *
 * @param path Any accepted spelling.
 * @returns The canonical dotted form.
 * @throws FormPathError for a path {@link parsePath} rejects.
 * @example
 * ```ts
 * import { canonicalPath } from "@shadow-js/forms";
 *
 * console.log(canonicalPath("lines[2].sku")); // "lines.2.sku"
 * ```
 * @since 1.0.0
 */
export function canonicalPath(path: string): string {
  return formatPath(parsePath(path));
}

/**
 * Reads the value at `segments` from `root`. Works on raw data and on store views: a store read
 * subscribes to each property it touches. Inherited properties (`toString`, `constructor`) are
 * not values, so they read as `undefined`.
 *
 * @param root Any value.
 * @param segments Parsed path. An empty list returns `root`.
 * @returns The value, or `undefined` when the path does not exist, passes through a value that is
 *   not an object, or names a reserved key. It never throws.
 * @example
 * ```ts
 * import { getIn, parsePath } from "@shadow-js/forms";
 *
 * const order = { lines: [{ sku: "A-1" }] };
 * console.log(getIn(order, parsePath("lines.0.sku"))); // "A-1"
 * console.log(getIn(order, ["lines", 3, "sku"])); // undefined
 * ```
 * @see {@link setIn}
 * @since 1.0.0
 */
export function getIn(root: unknown, segments: readonly Segment[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    const key = String(segment);
    // Reserved names are never data. Refusing them here keeps raw segments off the prototype.
    if (RESERVED.has(key) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** The container to create below `segment`'s parent: an array when the next step is an index. */
function containerFor(next: Segment | undefined): object {
  return typeof next === "number" ? [] : {};
}

/**
 * Throws if `setIn` would refuse this path, without writing anything: a refused write changes
 * nothing. It mirrors the write loop, including the empty containers it would create.
 */
function checkWritable(root: object, segments: readonly Segment[]): void {
  if (segments.length === 0)
    throw new FormPathError(__DEV__ ? "cannot write the root" : "FORMS_PATH_5");
  for (const segment of segments) {
    if (typeof segment === "string") checkKey(segment, "the path");
    // A negative, fractional or NaN index would become a junk key on the array.
    else if (!Number.isSafeInteger(segment) || segment < 0) {
      throw new FormPathError(__DEV__ ? `${segment} is not an array index` : "FORMS_PATH_3");
    }
  }
  let current: object = root;
  let fresh = false;
  for (const [depth, segment] of segments.entries()) {
    const holder = current;
    if (Array.isArray(holder)) {
      if (typeof segment !== "number") {
        throw new FormPathError(
          __DEV__
            ? `"${segment}" is not an array index in ${label(segments, depth)}`
            : "FORMS_PATH_4",
        );
      }
      const length = fresh ? 0 : holder.length;
      if (segment - length > MAX_FILL) {
        throw new FormPathError(
          __DEV__
            ? `index ${segment} is more than ${MAX_FILL} past the end of ${label(segments, depth)}`
            : "FORMS_PATH_2",
        );
      }
    }
    if (depth === segments.length - 1) return;
    const next = segments[depth + 1];
    const existing: unknown =
      isRecord(holder) && !fresh && Object.hasOwn(holder, String(segment))
        ? holder[String(segment)]
        : undefined;
    if (existing === undefined || existing === null) {
      fresh = true;
      current = containerFor(next);
    } else if (typeof existing !== "object") {
      throw notContainer(segments, depth);
    } else {
      fresh = false;
      current = existing;
    }
  }
}

/**
 * Writes `value` at `segments` inside a store draft (or any mutable plain data). Missing
 * containers are created (an array when the next step is an index). Writing past the end of an
 * array fills the gap with `undefined` so arrays stay dense (at most {@link MAX_FILL} slots);
 * writing through a scalar is an error because it would hide a mistyped path such as `name.first`.
 * The whole path is checked before the first write, so a refused write changes nothing.
 *
 * @param draft The draft object (the root of the store, or a child draft) or plain mutable data.
 * @param segments Parsed path, at least one segment.
 * @param value The value to store.
 * @throws FormPathError for an empty path, reserved keys, a scalar on the way, a key step into an
 *   array, and an index more than {@link MAX_FILL} past the end of an array.
 * @example
 * ```ts
 * import { setIn } from "@shadow-js/forms";
 *
 * const order: Record<string, unknown> = {};
 * setIn(order, ["lines", 0, "sku"], "A-1");
 * console.log(order); // { lines: [{ sku: "A-1" }] }
 * ```
 * @see {@link getIn}
 * @since 1.0.0
 */
export function setIn(draft: object, segments: readonly Segment[], value: unknown): void {
  checkWritable(draft, segments);
  let current: unknown = draft;
  for (let depth = 0; depth < segments.length - 1; depth += 1) {
    const key = String(segments[depth]);
    const next = segments[depth + 1];
    const holder = asRecord(current, segments, depth);
    const existing: unknown = Object.hasOwn(holder, key) ? holder[key] : undefined;
    if (existing === undefined || existing === null) {
      assignAt(holder, key, containerFor(next));
    }
    // Read back: a draft hands out a draft for the child, never the raw object.
    current = holder[key];
  }
  const last = segments.length - 1;
  assignAt(asRecord(current, segments, last), String(segments[last]), value);
}

/**
 * The step at `depth` as an object that can hold keys. {@link checkWritable} has already refused
 * every other step, so the error is only a guard for the type; it is never reached by a write.
 */
function asRecord(
  value: unknown,
  segments: readonly Segment[],
  depth: number,
): Record<string, unknown> {
  if (!isRecord(value)) throw notContainer(segments, depth);
  return value;
}

/** The error for a step that goes through a scalar. */
function notContainer(segments: readonly Segment[], depth: number): FormPathError {
  return new FormPathError(
    __DEV__ ? `${label(segments, depth)} is not an object or array` : "FORMS_PATH_6",
  );
}

/** Assigns `value` at `key`, filling an array gap with `undefined` first. */
function assignAt(target: Record<string, unknown>, key: string, value: unknown): void {
  if (Array.isArray(target)) {
    const index = Number(key);
    for (let fill = target.length; fill < index; fill += 1) target[fill] = undefined;
  }
  target[key] = value;
}

/**
 * Deletes the value at `segments` from plain data. Object keys are removed; array items are
 * spliced out. A path that does not exist is left alone.
 *
 * Not exported from a package entry.
 *
 * @param root Plain data (not a read-only store view).
 * @param segments Parsed path, at least one segment.
 * @returns Whether something was removed.
 * @internal
 */
export function deleteIn(root: object, segments: readonly Segment[]): boolean {
  if (segments.length === 0) return false;
  const parent = getIn(root, segments.slice(0, -1));
  if (typeof parent !== "object" || parent === null) return false;
  const key = String(segments[segments.length - 1]);
  if (RESERVED.has(key) || !Object.hasOwn(parent, key)) return false;
  if (Array.isArray(parent)) {
    // `length` is an own property of an array but not an item.
    if (!isIndex(key)) return false;
    parent.splice(Number(key), 1);
  } else if (isRecord(parent)) delete parent[key];
  return true;
}

function label(segments: readonly Segment[], depth: number): string {
  const upto = depth < 0 ? segments : segments.slice(0, depth + 1);
  return `"${upto.join(".")}"`;
}

/**
 * Compiles a pattern (`lines.*.sku`, `lines[].sku`) into steps for {@link matchesPattern}: `*`
 * and `[]` become {@link ANY}, which matches any single segment. These are the patterns the
 * `validators` option of `useForm` is keyed by.
 *
 * @param pattern The pattern text.
 * @returns Segments with {@link ANY} at each wildcard.
 * @throws FormPathError for a pattern outside the path grammar (see {@link parsePath}).
 * @example
 * ```ts
 * import { matchesPattern, parsePath, parsePattern } from "@shadow-js/forms";
 *
 * const skuOfAnyLine = parsePattern("lines.*.sku");
 * console.log(matchesPattern(skuOfAnyLine, parsePath("lines.3.sku"))); // true
 * ```
 * @since 1.0.0
 */
export function parsePattern(pattern: string): readonly PatternSegment[] {
  return parsePath(pattern, true);
}

/**
 * True when concrete `segments` match `pattern`, step by step. An {@link ANY} step matches any
 * segment; other steps compare as text, so the index `0` and the key `"0"` match each other.
 *
 * @param pattern A compiled pattern (from {@link parsePattern}).
 * @param segments A concrete path.
 * @returns Whether both have the same length and every step matches.
 * @example
 * ```ts
 * import { matchesPattern, parsePattern } from "@shadow-js/forms";
 *
 * const pattern = parsePattern("lines.*.sku");
 * console.log(matchesPattern(pattern, ["lines", 2, "sku"])); // true
 * console.log(matchesPattern(pattern, ["lines", 2, "qty"])); // false
 * console.log(matchesPattern(pattern, ["lines", 2, "sku", "code"])); // false
 * ```
 * @since 1.0.0
 */
export function matchesPattern(
  pattern: readonly PatternSegment[],
  segments: readonly Segment[],
): boolean {
  if (pattern.length !== segments.length) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    const step = pattern[index];
    if (step === ANY) continue;
    // `0` and "0" address the same slot of a container.
    if (String(step) !== String(segments[index])) return false;
  }
  return true;
}

/**
 * True when `segments` starts with every step of `prefix` (a path is under itself).
 * @param segments A path.
 * @param prefix A possible ancestor.
 * @returns Whether `prefix` addresses `segments` or one of its ancestors.
 * @internal
 */
export function startsWith(segments: readonly Segment[], prefix: readonly Segment[]): boolean {
  if (prefix.length > segments.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (String(segments[i]) !== String(prefix[i])) return false;
  }
  return true;
}
