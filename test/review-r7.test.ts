import { describe, expect, it } from "vitest";
import { formDataToValues, parseFormData } from "../src/server";
import type { StandardSchemaV1 } from "../src/standard-schema";

describe("rows past the end of the defaults", () => {
  it("[FORMS-R7-1] a row beyond the defaults array is coerced like the first default row", () => {
    const post = new URLSearchParams([
      ["lines[0].qty", "2"],
      ["lines[0].paid", "on"],
      ["lines[1].qty", "5"],
      ["lines[1].paid", "on"],
    ]);
    const values = formDataToValues(post, { defaults: { lines: [{ qty: 0, paid: false }] } });
    expect(values).toEqual({
      lines: [
        { qty: 2, paid: true },
        { qty: 5, paid: true },
      ],
    });
  });

  it("[FORMS-R7-2] a list field of a row past the defaults stays a list when posted once", () => {
    const post = new URLSearchParams([
      ["rows[0].tags", "a"],
      ["rows[1].tags", "c"],
    ]);
    const values = formDataToValues(post, { defaults: { rows: [{ tags: [""] }] } });
    expect(values).toEqual({ rows: [{ tags: ["a"] }, { tags: ["c"] }] });
  });

  it("[FORMS-R7-3] parseFormData coerces the extra rows too", async () => {
    const post = new URLSearchParams([
      ["lines[0].qty", "2"],
      ["lines[3].qty", "7"],
    ]);
    const schema: StandardSchemaV1<{ lines: unknown }, unknown> = {
      "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) },
    };
    const parsed = await parseFormData(schema, post, { defaults: { lines: [{ qty: 0 }] } });
    expect(parsed.values).toEqual({ lines: [{ qty: 2 }, undefined, undefined, { qty: 7 }] });
  });

  it("[FORMS-R7-4] an empty defaults array gives no shape, so values stay text", () => {
    const post = new URLSearchParams([["lines[0].qty", "2"]]);
    expect(formDataToValues(post, { defaults: { lines: [] } })).toEqual({
      lines: [{ qty: "2" }],
    });
  });

  it("[FORMS-R7-5] a multiple file input with no file gives an empty list", () => {
    const form = new FormData();
    form.append("files", new File([], ""));
    expect(formDataToValues(form, { defaults: { files: [] } })).toEqual({ files: [] });
    const real = new File(["x"], "a.txt");
    const two = new FormData();
    two.append("files", new File([], ""));
    two.append("files", real);
    expect(formDataToValues(two, { defaults: { files: [] } })).toEqual({ files: [real] });
  });
});
