import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deepEqual, isContainer, leafPaths, plainClone } from "../src/data";
import {
  canonicalPath,
  deleteIn,
  FormPathError,
  formatPath,
  getIn,
  isReservedKey,
  MAX_FILL,
  matchesPattern,
  parsePath,
  parsePattern,
  type Segment,
  setIn,
  startsWith,
} from "../src/path";

const SEED = { seed: 42, numRuns: 400 };

describe("path grammar", () => {
  it("[FRM-1] parses dotted, numeric and bracket spellings to the same segments", () => {
    expect(parsePath("user.emails.0.address")).toEqual(["user", "emails", 0, "address"]);
    expect(parsePath("lines[2].sku")).toEqual(["lines", 2, "sku"]);
    expect(parsePath("grid[1][0]")).toEqual(["grid", 1, 0]);
    expect(parsePath("007")).toEqual(["007"]);
    expect(canonicalPath("lines[2].sku")).toBe("lines.2.sku");
    expect(formatPath(["a", 0, "b"])).toBe("a.0.b");
  });

  it.each([
    "",
    ".a",
    "a.",
    "a..b",
    "a[",
    "a]",
    "a[b]",
    "a[01]",
    "a[-1]",
    "a[].b",
    "a b\u0000",
    "a.[0]",
  ])("[FRM-2] rejects the malformed path %j", (path) => {
    expect(() => parsePath(path)).toThrow(FormPathError);
  });

  it.each(["__proto__", "constructor", "prototype", "a.__proto__.b", "a.constructor"])(
    "[FRM-3] rejects the reserved key in %j and never reads it",
    (path) => {
      expect(() => parsePath(path)).toThrow(FormPathError);
      expect(isReservedKey("__proto__")).toBe(true);
    },
  );

  it("[FRM-4] getIn never returns inherited properties", () => {
    const data = { a: {} };
    expect(getIn(data, ["a", "toString"])).toBeUndefined();
    expect(getIn(data, ["a", "constructor"])).toBeUndefined();
    expect(getIn(data, ["__proto__"])).toBeUndefined();
    expect(getIn(null, ["a"])).toBeUndefined();
    expect(getIn("text", [0])).toBeUndefined();
    expect(getIn(data, [])).toBe(data);
  });

  it("[FRM-5] setIn creates arrays for index steps and objects for key steps", () => {
    const data: Record<string, unknown> = {};
    setIn(data, ["user", "emails", 0, "address"], "a@b");
    expect(data).toEqual({ user: { emails: [{ address: "a@b" }] } });
  });

  it("[FRM-6] setIn fills a gap with undefined so arrays stay dense", () => {
    const data: Record<string, unknown> = { rows: [] };
    setIn(data, ["rows", 3], "x");
    const rows = data["rows"] as unknown[];
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows)).toEqual(["0", "1", "2", "3"]);
    expect(rows.slice(0, 3)).toEqual([undefined, undefined, undefined]);
  });

  it("[FRM-7] setIn refuses a gap larger than MAX_FILL and writes nothing", () => {
    const data: Record<string, unknown> = { rows: [] };
    expect(() => setIn(data, ["rows", MAX_FILL + 1], 1)).toThrow(FormPathError);
    expect(data).toEqual({ rows: [] });
    expect(() => setIn(data, ["rows", 1_000_000_000, "x"], 1)).toThrow(FormPathError);
    expect(data).toEqual({ rows: [] });
  });

  it("[FRM-8] setIn through a scalar throws and leaves the data unchanged", () => {
    const data: Record<string, unknown> = { name: "ada" };
    expect(() => setIn(data, ["name", "first"], "x")).toThrow(FormPathError);
    expect(() => setIn(data, ["name", 0], "x")).toThrow(FormPathError);
    expect(data).toEqual({ name: "ada" });
  });

  it("[FRM-9] setIn refuses a key step into an array and reserved keys", () => {
    const data: Record<string, unknown> = { rows: [1] };
    expect(() => setIn(data, ["rows", "length"], 0)).toThrow(FormPathError);
    expect(() => setIn(data, ["__proto__", "x"], 1)).toThrow(FormPathError);
    expect(() => setIn(data, ["a", "constructor"], 1)).toThrow(FormPathError);
    expect(() => setIn(data, [], 1)).toThrow(FormPathError);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
    expect(data).toEqual({ rows: [1] });
  });

  it("[FRM-10] setIn on a path with missing intermediates creates them; nested undefined is replaced", () => {
    const data: Record<string, unknown> = { a: undefined, b: null };
    setIn(data, ["a", "x"], 1);
    setIn(data, ["b", 0], 2);
    expect(data).toEqual({ a: { x: 1 }, b: [2] });
  });

  it("[FRM-11] deleteIn removes object keys and splices array items", () => {
    const data = { a: { b: 1, c: 2 }, rows: [1, 2, 3] };
    expect(deleteIn(data, ["a", "b"])).toBe(true);
    expect(deleteIn(data, ["rows", 1])).toBe(true);
    expect(deleteIn(data, ["missing", "x"])).toBe(false);
    expect(deleteIn(data, ["a", "constructor"])).toBe(false);
    expect(data).toEqual({ a: { c: 2 }, rows: [1, 3] });
  });

  it("[FRM-12] patterns match any one step with * or []", () => {
    const pattern = parsePattern("lines.*.sku");
    expect(matchesPattern(pattern, parsePath("lines.3.sku"))).toBe(true);
    expect(matchesPattern(pattern, parsePath("lines.3.qty"))).toBe(false);
    expect(matchesPattern(pattern, parsePath("lines.3.sku.x"))).toBe(false);
    expect(matchesPattern(parsePattern("lines[].sku"), parsePath("lines.0.sku"))).toBe(true);
    expect(matchesPattern(parsePattern("a.b"), ["a", "b"])).toBe(true);
    // Outside a pattern, "*" is an ordinary key.
    expect(parsePath("a.*")).toEqual(["a", "*"]);
    expect(startsWith(["a", 1, "b"], ["a", 1])).toBe(true);
    expect(startsWith(["a"], ["a", 1])).toBe(false);
  });
});

// A key alphabet without digit-only strings or reserved names, so keys round-trip exactly.
const keyArb = fc.constantFrom("a", "b", "c", "user", "x y", "é");
const segmentArb: fc.Arbitrary<Segment> = fc.oneof(keyArb, fc.integer({ min: 0, max: 4 }));
const segmentsArb = fc.array(segmentArb, { minLength: 1, maxLength: 5 });

describe("path properties", () => {
  it("[FRM-13] formatPath and parsePath are inverse", () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        expect(parsePath(formatPath(segments))).toEqual(segments);
      }),
      SEED,
    );
  });

  it("[FRM-14] bracket spelling parses to the same segments as the dotted one", () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const bracket = segments
          .map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`))
          .join("");
        expect(parsePath(bracket)).toEqual(segments);
      }),
      SEED,
    );
  });
});

/** The naive model: an immutable tree update with the documented rules. */
function naiveSet(root: unknown, segments: readonly Segment[], value: unknown): unknown | "error" {
  const [head, ...rest] = segments as [Segment, ...Segment[]];
  let base: unknown = root;
  if (base === undefined || base === null) base = typeof head === "number" ? [] : {};
  if (Array.isArray(base)) {
    if (typeof head !== "number") return "error";
    if (head - base.length > MAX_FILL) return "error";
    const copy = [...base];
    for (let i = copy.length; i < head; i += 1) copy[i] = undefined;
    const child =
      rest.length === 0
        ? value
        : naiveSet(Object.hasOwn(base, head) ? base[head] : undefined, rest, value);
    if (child === "error" && rest.length > 0) return "error";
    copy[head] = child;
    return copy;
  }
  if (typeof base !== "object" || base === null) return "error";
  const copy: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const key = String(head);
  const child =
    rest.length === 0
      ? value
      : naiveSet(
          Object.hasOwn(base, key) ? (base as Record<string, unknown>)[key] : undefined,
          rest,
          value,
        );
  if (child === "error" && rest.length > 0) return "error";
  copy[key] = child;
  return copy;
}

const valueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);
const treeArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { maxDepth: 3 },
    valueArb,
    fc.array(tie("tree"), { maxLength: 3 }),
    fc.dictionary(keyArb, tie("tree"), { maxKeys: 3 }),
  ),
})).tree;

describe("path properties against a naive model", () => {
  it("[FRM-15] setIn equals the naive immutable update, and a refused write changes nothing", () => {
    fc.assert(
      fc.property(
        fc.dictionary(keyArb, treeArb, { maxKeys: 3 }),
        segmentsArb,
        valueArb,
        (initial, segments, value) => {
          const expected = naiveSet(initial, segments, value);
          const actual = plainClone(initial);
          if (expected === "error") {
            expect(() => setIn(actual, segments, value)).toThrow(FormPathError);
            expect(actual).toEqual(initial);
            return;
          }
          setIn(actual, segments, value);
          expect(actual).toEqual(expected);
          expect(getIn(actual, segments)).toEqual(value);
        },
      ),
      SEED,
    );
  });

  it("[FRM-16] getIn equals a naive walk and never throws", () => {
    fc.assert(
      fc.property(treeArb, segmentsArb, (tree, segments) => {
        let node: unknown = tree;
        for (const s of segments) {
          node =
            typeof node === "object" && node !== null && Object.hasOwn(node, String(s))
              ? (node as Record<string, unknown>)[String(s)]
              : undefined;
        }
        expect(getIn(tree, segments)).toEqual(node);
      }),
      SEED,
    );
  });

  it("[FRM-17] leafPaths lists exactly the non-container values, in document order", () => {
    fc.assert(
      fc.property(treeArb, (tree) => {
        const naive: Segment[][] = [];
        const walk = (node: unknown, at: Segment[]): void => {
          if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i += 1) walk(node[i], [...at, i]);
          } else if (typeof node === "object" && node !== null) {
            for (const key of Object.keys(node))
              walk((node as Record<string, unknown>)[key], [...at, key]);
          } else if (at.length > 0) naive.push(at);
        };
        walk(tree, []);
        expect(leafPaths(tree)).toEqual(naive);
      }),
      SEED,
    );
  });
});

describe("data helpers", () => {
  it("[FRM-18] plainClone copies containers, shares dates and files, densifies sparse arrays", () => {
    const date = new Date(0);
    // biome-ignore lint/suspicious/noSparseArray: the test is about sparse input
    const sparse = [1, , 3];
    const original = { date, sparse, nested: { list: [{ a: 1 }] } };
    const copy = plainClone(original);
    expect(copy).toEqual({ date, sparse: [1, undefined, 3], nested: { list: [{ a: 1 }] } });
    expect(copy.date).toBe(date);
    expect(Object.keys(copy.sparse)).toEqual(["0", "1", "2"]);
    expect(copy.nested).not.toBe(original.nested);
  });

  it("[FRM-19] plainClone refuses reserved keys in data and preserves cycles", () => {
    expect(() => plainClone(JSON.parse('{"__proto__": {"x": 1}}'))).toThrow(FormPathError);
    const cyclic: Record<string, unknown> = { name: "a" };
    cyclic["self"] = cyclic;
    const copy = plainClone(cyclic);
    expect(copy["self"]).toBe(copy);
    expect(copy).not.toBe(cyclic);
  });

  it("[FRM-20] deepEqual compares by content, dates by time, NaN with NaN, key order free", () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(deepEqual({}, [])).toBe(false);
    const file = new Blob(["x"]);
    expect(deepEqual({ file }, { file })).toBe(true);
    expect(deepEqual({ file }, { file: new Blob(["x"]) })).toBe(false);
    expect(isContainer(new Date())).toBe(false);
  });

  it("[FRM-21] deepEqual terminates on cycles and deep nesting without overflowing the stack", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    const b: Record<string, unknown> = {};
    b["self"] = b;
    expect(deepEqual(a, b)).toBe(true);
    let deepA: unknown = 0;
    let deepB: unknown = 0;
    for (let i = 0; i < 50_000; i += 1) {
      deepA = { next: deepA };
      deepB = { next: deepB };
    }
    expect(deepEqual(deepA, deepB)).toBe(true);
    expect(plainClone(deepA)).toBeDefined();
  });
});
