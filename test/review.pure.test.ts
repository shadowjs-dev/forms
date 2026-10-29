import { describe, expect, it } from "vitest";
import { formDataToValues } from "../src/form-data";
import { deleteIn, FormPathError, setIn } from "../src/path";
import { issuesToErrors } from "../src/server-issues";

describe("review round: pure helpers", () => {
  it("[FORMS-REV-4] issuesToErrors groups a path named like an Object.prototype member (toString, valueOf) instead of throwing", () => {
    const errors = issuesToErrors([
      { path: "toString", message: "bad" },
      { path: "valueOf", message: "worse" },
      { path: "toString", message: "again" },
    ]);
    expect(Object.keys(errors)).toEqual(["toString", "valueOf"]);
    expect(errors["toString"]).toEqual([{ message: "bad" }, { message: "again" }]);
    expect(errors["valueOf"]).toEqual([{ message: "worse" }]);
  });

  it("[FORMS-REV-6] a posted number is a finite decimal: Infinity, overflow and hex or binary text are not numbers", () => {
    const values = formDataToValues(
      [
        ["inf", "Infinity"],
        ["overflow", "1e999"],
        ["hex", "0x10"],
        ["bin", "0b11"],
        ["ok", " -12.5e1 "],
        ["lead", ".5"],
        ["trail", "5."],
      ],
      { defaults: { inf: 0, overflow: 0, hex: 0, bin: 0, ok: 0, lead: 0, trail: 0 } },
    );
    expect(values).toEqual({
      inf: undefined,
      overflow: undefined,
      hex: undefined,
      bin: undefined,
      ok: -125,
      lead: 0.5,
      trail: 5,
    });
  });

  it("[FORMS-REV-7] a name that clashes with an earlier container name is skipped whatever the order, never overwriting it", () => {
    const skipped: string[] = [];
    const onSkip = (name: string, reason: unknown): void => {
      expect(reason).toBeInstanceOf(FormPathError);
      skipped.push(name);
    };
    const nestedFirst = formDataToValues(
      [
        ["a.b", "1"],
        ["a", "2"],
      ],
      { onSkip },
    );
    const scalarFirst = formDataToValues(
      [
        ["a", "2"],
        ["a.b", "1"],
      ],
      { onSkip },
    );
    expect(nestedFirst).toEqual({ a: { b: "1" } });
    expect(scalarFirst).toEqual({ a: "2" });
    expect(skipped).toEqual(["a", "a.b"]);
  });

  it("[FORMS-REV-8] setIn refuses an index that is negative, fractional or NaN instead of writing a junk key on the array", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const data: { list: unknown[] } = { list: [1] };
      expect(() => setIn(data, ["list", bad], "x")).toThrow(FormPathError);
      expect(Reflect.ownKeys(data.list).map(String)).toEqual(["0", "length"]);
      const fresh: Record<string, unknown> = {};
      expect(() => setIn(fresh, ["made", bad, "deep"], "x")).toThrow(FormPathError);
      expect(fresh).toEqual({});
    }
  });

  it("[FORMS-REV-9] deleteIn never treats the array property `length` as an item", () => {
    const data = { list: ["a", "b"] };
    expect(deleteIn(data, ["list", "length"])).toBe(false);
    expect(data.list).toEqual(["a", "b"]);
    expect(deleteIn(data, ["list", 0])).toBe(true);
    expect(data.list).toEqual(["b"]);
  });
});

describe("review round two: fillMissing", () => {
  it("[FORMS-R2-5] defaults with more rows than the post do not create a row for an unchecked checkbox", () => {
    const defaults = {
      rows: [
        { name: "", flag: false },
        { name: "", flag: false },
      ],
      agree: false,
    };
    const values = formDataToValues(
      [
        ["rows.0.name", "first"],
        ["rows.0.flag", "on"],
      ],
      { defaults },
    );
    expect(values).toEqual({ rows: [{ name: "first", flag: true }], agree: false });
  });

  it("[FORMS-R2-5] a posted row still gets false for the checkbox it left out", () => {
    const defaults = { rows: [{ name: "", flag: false }] };
    expect(formDataToValues([["rows.0.name", "x"]], { defaults })).toEqual({
      rows: [{ name: "x", flag: false }],
    });
  });

  it("[FORMS-R2-5] no rows posted at all: rows with a text field are not invented, rows of checkboxes only are kept", () => {
    expect(
      formDataToValues([], {
        defaults: { rows: [{ name: "", flag: false }], ticks: [{ on: false }] },
      }),
    ).toEqual({ ticks: [{ on: false }] });
  });

  it("[FORMS-REV-7] a very long run of digits that is not a number is refused in linear time", () => {
    const hostile = `${"1".repeat(200_000)}x`;
    const started = performance.now();
    const values = formDataToValues([["age", hostile]], { defaults: { age: 0 } });
    expect(values).toEqual({ age: undefined });
    // The quadratic form of the pattern needs tens of seconds here.
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
