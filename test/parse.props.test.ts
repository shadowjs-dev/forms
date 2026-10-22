import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formDataToValues } from "../src/server";

/** An empty list of the given item type: a list default whose items are typed by the caller. */
function emptyList<T>(): T[] {
  return [];
}

/** Builds a `FormData` the way a browser does: one entry per control value, in order. */
function formOf(pairs: ReadonlyArray<readonly [string, FormDataEntryValue]>): FormData {
  const data = new FormData();
  for (const [name, value] of pairs) data.append(name, value);
  return data;
}

describe("native post: names", () => {
  it("[FRM-900] dotted and numeric names nest, a leading zero is a key, and bracket names take indexes only", () => {
    const skipped: string[] = [];
    const values = formDataToValues(
      formOf([
        ["a.b.0", "first"],
        ["a.b.1.c", "second"],
        ["codes.007", "seven"],
        ["grid[0][1]", "x"],
        ["a[b][0]", "dropped"],
      ]),
      { onSkip: (name) => skipped.push(name) },
    );
    expect(values).toEqual({
      a: { b: ["first", { c: "second" }] },
      codes: { "007": "seven" },
      grid: [[undefined, "x"]],
    });
    // Brackets hold array indexes only: a Rails-style `a[b]` name is refused and reported.
    expect(skipped).toEqual(["a[b][0]"]);
  });

  it("[FRM-901] one value for a list field becomes a one-item list; repeated values for a scalar become a list; a missing list is []", () => {
    const values = formDataToValues(
      formOf([
        ["tags", "solo"],
        ["title", "one"],
        ["title", "two"],
      ]),
      { defaults: { tags: emptyList<string>(), title: "", ids: emptyList<number>() } },
    );
    expect(values).toEqual({ tags: ["solo"], title: ["one", "two"], ids: [] });
  });

  it("[FRM-902] a list of numbers coerces each item to the item shape and keeps the empty ones undefined", () => {
    const values = formDataToValues(
      formOf([
        ["scores", "1"],
        ["scores", ""],
        ["scores", "2.5"],
      ]),
      {
        defaults: { scores: [0] },
      },
    );
    expect(values).toEqual({ scores: [1, undefined, 2.5] });
  });
});

describe("native post: files", () => {
  it("[FRM-903] a file keeps its name, type and bytes; a repeated file input is a list of files; an empty input is undefined", () => {
    const avatar = new File(["png-bytes"], "me.png", { type: "image/png" });
    const docA = new File(["a"], "a.txt", { type: "text/plain" });
    const docB = new File(["bb"], "b.txt", { type: "text/plain" });
    const values = formDataToValues<{
      profile: { avatar: File | undefined };
      docs: File[];
      empty: File | undefined;
    }>(
      formOf([
        ["profile.avatar", avatar],
        ["docs", docA],
        ["docs", docB],
        ["empty", new File([], "")],
      ]),
      { defaults: { profile: { avatar: undefined }, docs: emptyList<File>(), empty: undefined } },
    );
    expect(values.profile.avatar).toBe(avatar);
    expect(values.profile.avatar?.name).toBe("me.png");
    expect(values.profile.avatar?.type).toBe("image/png");
    expect(values.profile.avatar?.size).toBe(avatar.size);
    expect(values.docs).toEqual([docA, docB]);
    expect(values.docs[1]).toBe(docB);
    expect(values.empty).toBeUndefined();
  });
});

describe("native post: prototype pollution", () => {
  it("[FRM-904] reserved keys in any position are skipped and Object.prototype is unchanged afterward", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const skipped: string[] = [];
    const values = formDataToValues(
      formOf([
        ["__proto__", "x"],
        ["__proto__", "y"],
        ["a.__proto__.isAdmin", "true"],
        ["constructor", "x"],
        ["constructor.prototype.isAdmin", "true"],
        ["prototype", "x"],
        ["list.0.constructor", "x"],
        ["ok", "fine"],
      ]),
      { onSkip: (name) => skipped.push(name) },
    );
    expect(values).toEqual({ ok: "fine" });
    expect(skipped).toHaveLength(7);
    expect(Reflect.get({}, "isAdmin")).toBeUndefined();
    expect(Reflect.get({}, "x")).toBeUndefined();
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
  });

  it("[FRM-905] ordinary keys named like Object.prototype members are own properties and do not break the read", () => {
    const defaults: { toString: string; profile: Record<string, string> } = {
      toString: "",
      profile: {},
    };
    const values = formDataToValues(
      formOf([
        ["toString", "t"],
        ["hasOwnProperty", "h"],
        ["valueOf", "v"],
        ["__PROTO__", "upper"],
        ["profile.toString", "nested"],
      ]),
      { defaults },
    );
    expect(Object.keys(values).sort()).toEqual([
      "__PROTO__",
      "hasOwnProperty",
      "profile",
      "toString",
      "valueOf",
    ]);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Reflect.get(values, "toString")).toBe("t");
    expect(Reflect.get(values, "hasOwnProperty")).toBe("h");
    expect(Reflect.get(values, "__PROTO__")).toBe("upper");
  });

  it("[FRM-906] a control character or an empty step in a name is skipped and reported with a FormPathError", () => {
    const reasons: unknown[] = [];
    const values = formDataToValues(
      formOf([
        ["bad\u0007name", "x"],
        ["a..b", "y"],
        ["fine", "z"],
      ]),
      { onSkip: (_name, reason) => reasons.push(reason) },
    );
    expect(values).toEqual({ fine: "z" });
    expect(reasons).toHaveLength(2);
    for (const reason of reasons) {
      expect(reason).toBeInstanceOf(TypeError);
      expect(reason instanceof Error ? reason.name : "").toBe("FormPathError");
    }
  });
});

describe("native post: size", () => {
  it("[FRM-907] 10,000 fields are read exactly; 10,001 are refused; a repeated name of 10,000 values is one list", () => {
    const pairs: Array<[string, string]> = Array.from({ length: 10_000 }, (_, i) => [
      `f${i}`,
      String(i),
    ]);
    const values = formDataToValues<Record<string, string>>(formOf(pairs));
    expect(Object.keys(values)).toHaveLength(10_000);
    expect(values["f0"]).toBe("0");
    expect(values["f9999"]).toBe("9999");
    expect(() => formDataToValues(formOf([...pairs, ["extra", "1"]]))).toThrow(RangeError);
    const many = formDataToValues<{ tags: string[] }>(
      formOf(Array.from({ length: 10_000 }, (_, i): [string, string] => ["tags", `t${i}`])),
      { defaults: { tags: emptyList<string>() } },
    );
    expect(many.tags).toHaveLength(10_000);
    expect(many.tags[9999]).toBe("t9999");
  });
});

describe("native post: text", () => {
  it("[FRM-908] accented, emoji and right-to-left names and values are kept as written, without normalization", () => {
    const decomposed = "é";
    const values = formDataToValues<Record<string, unknown>>(
      formOf([
        ["café", "crème brûlée"],
        ["user.🙂", "smile 🙂"],
        ["مرحبا", "نص عربي"],
        ["word", decomposed],
        ["name with spaces", "  padded  "],
        ["multi", "line one\nline two"],
      ]),
    );
    expect(values).toEqual({
      café: "crème brûlée",
      user: { "🙂": "smile 🙂" },
      مرحبا: "نص عربي",
      word: decomposed,
      "name with spaces": "  padded  ",
      multi: "line one\nline two",
    });
    expect(values["word"]).toBe(decomposed);
    expect(String(values["word"]).length).toBe(2);
  });
});

describe("native post: empty values", () => {
  it('[FRM-909] an empty text stays "" by default, becomes undefined or null by policy; empty numbers and dates are undefined, an empty boolean is false', () => {
    const pairs: Array<[string, string]> = [
      ["nickname", ""],
      ["age", ""],
      ["born", ""],
      ["subscribed", ""],
    ];
    const defaults = { nickname: "", age: 0, born: new Date(0), subscribed: false };
    expect(formDataToValues(formOf(pairs), { defaults })).toEqual({
      nickname: "",
      age: undefined,
      born: undefined,
      subscribed: false,
    });
    expect(formDataToValues(formOf(pairs), { defaults, emptyValue: "undefined" })).toMatchObject({
      nickname: undefined,
    });
    expect(formDataToValues(formOf(pairs), { defaults, emptyValue: "null" })).toMatchObject({
      nickname: null,
    });
  });
});

describe("native post: checkboxes and selects", () => {
  it("[FRM-910] an unchecked checkbox posts nothing: with defaults it is false (also nested); without defaults the key is absent", () => {
    const defaults = { agree: false, news: { weekly: false, daily: false }, plan: "free" };
    expect(
      formDataToValues(
        formOf([
          ["news.daily", "on"],
          ["plan", "pro"],
        ]),
        { defaults },
      ),
    ).toEqual({
      agree: false,
      news: { weekly: false, daily: true },
      plan: "pro",
    });
    expect(formDataToValues(formOf([["agree", "on"]]))).toEqual({ agree: "on" });
    expect(formDataToValues(formOf([]))).toEqual({});
  });

  it("[FRM-911] a multiple select posts one entry per chosen option: a list with the defaults, zero options is [], one is still a list", () => {
    const defaults = { colors: emptyList<string>(), size: "m" };
    expect(
      formDataToValues(
        formOf([
          ["colors", "red"],
          ["colors", "blue"],
          ["size", "l"],
        ]),
        { defaults },
      ),
    ).toEqual({ colors: ["red", "blue"], size: "l" });
    expect(formDataToValues(formOf([["size", "s"]]), { defaults })).toEqual({
      colors: [],
      size: "s",
    });
    // A text-like control that posted nothing is absent, not filled from its default.
    expect(formDataToValues(formOf([["colors", "green"]]), { defaults })).toEqual({
      colors: ["green"],
    });
  });
});

describe("native post: property round trip", () => {
  const key = fc.constantFrom(
    "name",
    "café",
    "名前",
    "🙂",
    "مرحبا",
    "a b",
    "x_1",
    "007",
    "Zed",
    "profile_first",
  );
  const text = fc.string({ unit: "grapheme", maxLength: 12 });
  const number = fc.oneof(
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((x) => x + 0),
  );
  type Item =
    | { kind: "text"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "list"; value: string[] };
  const value: fc.Arbitrary<Item> = fc.oneof(
    text.map((t): Item => ({ kind: "text", value: t })),
    number.map((n): Item => ({ kind: "number", value: n })),
    fc.boolean().map((b): Item => ({ kind: "boolean", value: b })),
    fc.array(text, { maxLength: 3 }).map((list): Item => ({ kind: "list", value: list })),
  );

  it("[FRM-912] random flat objects built into a FormData read back to the same values (seed 42)", () => {
    fc.assert(
      fc.property(fc.dictionary(key, value, { maxKeys: 6 }), (original) => {
        const data = new FormData();
        const defaults: Record<string, unknown> = {};
        for (const [name, item] of Object.entries(original)) {
          if (item.kind === "list") {
            defaults[name] = [];
            for (const entry of item.value) data.append(name, entry);
          } else if (item.kind === "boolean") {
            defaults[name] = false;
            if (item.value) data.append(name, "on");
          } else if (item.kind === "number") {
            defaults[name] = 0;
            data.append(name, String(item.value));
          } else {
            defaults[name] = "";
            data.append(name, item.value);
          }
        }
        const expected: Record<string, unknown> = {};
        for (const [name, item] of Object.entries(original)) expected[name] = item.value;
        expect(formDataToValues(data, { defaults })).toEqual(expected);
      }),
      { seed: 42, numRuns: 200 },
    );
  });
});
