import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractIssues, formDataToValues, issuesToErrors, parseFormData } from "../src/server";
import { customSchema } from "./support/schemas";

const form = (pairs: Array<[string, string | Blob]>): FormData => {
  const data = new FormData();
  for (const [name, value] of pairs) data.append(name, value);
  return data;
};

describe("formDataToValues", () => {
  it("[FRM-180] reads dotted, numeric and bracket names into nested objects and arrays", () => {
    const values = formDataToValues(
      form([
        ["name", "Ada"],
        ["user.emails.0.address", "a@x"],
        ["user.emails.1.address", "b@x"],
        ["lines[0].sku", "S1"],
        ["grid[1][0]", "g"],
      ]),
    );
    expect(values).toEqual({
      name: "Ada",
      user: { emails: [{ address: "a@x" }, { address: "b@x" }] },
      lines: [{ sku: "S1" }],
      grid: [undefined, ["g"]],
    });
  });

  it("[FRM-181] the defaults guide coercion: numbers, booleans (absent means false), dates, lists", () => {
    const values = formDataToValues(
      form([
        ["age", "41"],
        ["height", ""],
        ["agree", "on"],
        ["born", "1815-12-10"],
        ["tags", "a"],
        ["scores", "1"],
        ["scores", "2"],
        ["title", ""],
      ]),
      {
        defaults: {
          age: 0,
          height: 0,
          agree: false,
          newsletter: false,
          born: new Date(0),
          tags: ["x"],
          scores: [0],
          title: "",
          untouched: [] as string[],
        },
      },
    );
    expect(values).toEqual({
      age: 41,
      height: undefined,
      agree: true,
      newsletter: false,
      born: new Date("1815-12-10"),
      tags: ["a"],
      scores: [1, 2],
      title: "",
      untouched: [],
    });
  });

  it("[FRM-182] repeated names become a list even without defaults; the empty-text policy applies", () => {
    const data = form([
      ["c", "1"],
      ["c", "2"],
      ["e", ""],
    ]);
    expect(formDataToValues(data)).toEqual({ c: ["1", "2"], e: "" });
    expect(formDataToValues(data, { emptyValue: "undefined" })).toEqual({
      c: ["1", "2"],
      e: undefined,
    });
    expect(formDataToValues(data, { emptyValue: "null" })).toEqual({ c: ["1", "2"], e: null });
  });

  it("[FRM-183] an empty file input is not a value; real files pass through", () => {
    const empty = new File([], "");
    const real = new File(["x"], "x.txt");
    const values = formDataToValues(
      form([
        ["a", empty],
        ["b", real],
      ]),
    );
    expect(values).toEqual({ a: undefined, b: real });
    expect((values as { b: File }).b).toBe(real);
  });

  it("[FRM-184] names with reserved keys, odd syntax or sparse-array bombs are skipped and reported, never written", () => {
    const skipped: string[] = [];
    const values = formDataToValues(
      form([
        ["__proto__.polluted", "yes"],
        ["constructor.prototype.polluted", "yes"],
        ["a..b", "x"],
        ["rows.999999.x", "bomb"],
        ["ok", "fine"],
        ["a", "scalar"],
        ["a.b", "clash"],
      ]),
      { onSkip: (name) => skipped.push(name) },
    );
    expect(values).toEqual({ ok: "fine", a: "scalar" });
    expect(skipped).toEqual([
      "__proto__.polluted",
      "constructor.prototype.polluted",
      "a..b",
      "rows.999999.x",
      "a.b",
    ]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("[FRM-185] accepts URLSearchParams and plain entry lists, and refuses more than maxFields entries", () => {
    expect(formDataToValues(new URLSearchParams("a=1&b.c=2"))).toEqual({ a: "1", b: { c: "2" } });
    expect(formDataToValues([["a", "1"]])).toEqual({ a: "1" });
    expect(() => formDataToValues(new URLSearchParams("a=1&b=2&c=3"), { maxFields: 2 })).toThrow(
      RangeError,
    );
  });
});

describe("formDataToValues round trip", () => {
  const leaf = fc.oneof(fc.string(), fc.integer({ min: -1000, max: 1000 }), fc.boolean());
  const key = fc.constantFrom("a", "b", "c");
  const node: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    node: fc.oneof(
      { maxDepth: 3 },
      leaf,
      fc.array(tie("node"), { minLength: 1, maxLength: 3 }),
      fc.dictionary(key, tie("node"), { minKeys: 1, maxKeys: 3 }),
    ),
  })).node;

  /** Flattens a value to the pairs a browser posts for the same form. */
  function serialize(value: unknown, path: string, out: Array<[string, string]>): void {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        serialize(value[index], path === "" ? String(index) : `${path}.${index}`, out);
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [name, item] of Object.entries(value))
        serialize(item, path === "" ? name : `${path}.${name}`, out);
    } else if (typeof value === "boolean") {
      if (value) out.push([path, "on"]);
    } else {
      out.push([path, String(value)]);
    }
  }

  it("[FRM-186] posting a form and reading it back with the form's defaults gives the original values", () => {
    fc.assert(
      fc.property(fc.dictionary(key, node, { minKeys: 1, maxKeys: 3 }), (original) => {
        const pairs: Array<[string, string]> = [];
        serialize(original, "", pairs);
        const read = formDataToValues(form(pairs), { defaults: original });
        expect(read).toEqual(original);
      }),
      { seed: 42, numRuns: 200 },
    );
  });
});

describe("parseFormData and issues", () => {
  const schema = z.object({
    email: z.string().min(3, "too short"),
    age: z.number().min(18, "adult only"),
    agree: z.boolean(),
  });

  it("[FRM-187] validates the post with the same schema and returns the output", async () => {
    const result = await parseFormData(
      schema,
      form([
        ["email", "ada@x"],
        ["age", "40"],
        ["agree", "on"],
      ]),
      { defaults: { email: "", age: 0, agree: false } },
    );
    expect(result).toEqual({
      success: true,
      data: { email: "ada@x", age: 40, agree: true },
      values: { email: "ada@x", age: 40, agree: true },
    });
  });

  it("[FRM-188] a failing post returns the problems by path and what was posted, ready for initialErrors", async () => {
    const result = await parseFormData(
      schema,
      form([
        ["email", "a"],
        ["age", "5"],
      ]),
      {
        defaults: { email: "", age: 0, agree: false },
      },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual([
      { path: "email", message: "too short" },
      { path: "age", message: "adult only" },
    ]);
    expect(result.errors).toEqual({
      email: [{ message: "too short" }],
      age: [{ message: "adult only" }],
    });
    expect(result.values).toEqual({ email: "a", age: 5, agree: false });
  });

  it("[FRM-189] works with any Standard Schema, sync or async", async () => {
    const custom = customSchema(
      [{ path: ["name"], check: (v) => (v === "" ? "required" : undefined) }],
      {
        asynchronous: true,
      },
    );
    const result = await parseFormData(custom, form([["name", ""]]));
    expect(result).toMatchObject({
      success: false,
      issues: [{ path: "name", message: "required" }],
    });
  });

  it("[FRM-190] extractIssues reads Standard Schema issues, ValidationError shapes, fieldErrors and maps", () => {
    expect(extractIssues([{ message: "m", path: ["a", 0, { key: "b" }] }])).toEqual([
      { path: "a.0.b", message: "m" },
    ]);
    expect(extractIssues({ issues: [{ message: "m", path: ["a"] }] })).toEqual([
      { path: "a", message: "m" },
    ]);
    expect(
      extractIssues(
        Object.assign(new Error("x"), { data: { issues: [{ message: "m", path: [] }] } }),
      ),
    ).toEqual([{ path: "", message: "m" }]);
    expect(extractIssues({ fieldErrors: { a: ["x", "y"], "b[0]": "z" } })).toEqual([
      { path: "a", message: "x" },
      { path: "a", message: "y" },
      { path: "b.0", message: "z" },
    ]);
    expect(extractIssues({ a: "x", b: { message: "y", type: "t" } })).toEqual([
      { path: "a", message: "x" },
      { path: "b", message: "y", type: "t" },
    ]);
    expect(extractIssues({ a: 1 })).toBeUndefined();
    expect(extractIssues(new Error("plain"))).toBeUndefined();
    expect(extractIssues(null)).toBeUndefined();
    expect(extractIssues("text")).toBeUndefined();
    expect(extractIssues([{ message: "m", path: ["__proto__", "x"] }])).toEqual([
      { path: "", message: "m" },
    ]);
    expect(
      issuesToErrors([
        { path: "a", message: "x" },
        { path: "a", message: "y", type: "t" },
      ]),
    ).toEqual({
      a: [{ message: "x" }, { message: "y", type: "t" }],
    });
  });
});
