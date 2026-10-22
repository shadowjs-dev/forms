import { describe, expect, it, vi } from "vitest";
import { applyServerErrors } from "../src/index";
import { extractIssues, issuesToErrors } from "../src/server";
import { makeForm } from "./support/forms";

const rows = { items: [{ name: "a" }, { name: "b" }] };

describe("server issue paths", () => {
  it("[FRM-860] the same field is named by the dotted, bracket and array spellings, and by {key} steps; they all land on one canonical path", () => {
    expect(extractIssues([{ message: "dotted", path: ["items", 0, "name"] }])).toEqual([
      { path: "items.0.name", message: "dotted" },
    ]);
    expect(
      extractIssues([
        { message: "keys", path: [{ key: "items" }, { key: 0 }, { key: "name" }] },
        { message: "text index", path: ["items", "0", "name"] },
      ]),
    ).toEqual([
      { path: "items.0.name", message: "keys" },
      { path: "items.0.name", message: "text index" },
    ]);
    expect(
      extractIssues({
        fieldErrors: { "items[0].name": "bracket", "items.0.name": "dotted text" },
      }),
    ).toEqual([
      { path: "items.0.name", message: "bracket" },
      { path: "items.0.name", message: "dotted text" },
    ]);

    const form = makeForm({ defaultValues: rows });
    expect(
      applyServerErrors(form, [
        { message: "dotted", path: ["items", 0, "name"] },
        { message: "keys", path: [{ key: "items" }, { key: 0 }, { key: "name" }] },
        { message: "bracket", path: ["items", 0, "name"] },
      ]),
    ).toEqual({ applied: true, paths: ["items.0.name"] });
    expect(
      form
        .fieldAt("items[0].name")
        .errors()
        .map((issue) => issue.message),
    ).toEqual(["dotted", "keys", "bracket"]);
  });

  it("[FRM-861] problems without a usable path (none, empty, reserved, empty key, unparsable map text) land on the form as a whole", () => {
    const issues = extractIssues([
      { message: "no path" },
      { message: "empty path", path: [] },
      { message: "empty key", path: [""] },
      { message: "reserved", path: ["__proto__"] },
      { message: "constructor", path: ["constructor", "name"] },
    ]);
    expect(issues).toEqual([
      { path: "", message: "no path" },
      { path: "", message: "empty path" },
      { path: "", message: "empty key" },
      { path: "", message: "reserved" },
      { path: "", message: "constructor" },
    ]);
    expect(
      extractIssues({ "": "whole form", "items['0']": "unparsable", constructor: "x" }),
    ).toEqual([
      { path: "", message: "whole form" },
      { path: "", message: "unparsable" },
      { path: "", message: "x" },
    ]);

    const form = makeForm({ defaultValues: rows });
    const result = applyServerErrors(form, [
      { message: "no path" },
      { message: "reserved", path: ["__proto__"] },
    ]);
    expect(result).toEqual({ applied: true, paths: [""] });
    expect(form.formErrors().map((issue) => issue.message)).toEqual(["no path", "reserved"]);
    expect(form.errors()).toEqual({});
  });

  it("[FRM-862] a path step that cannot name a field (a key with a dot or a bracket, a negative or fractional index) is the form as a whole: it is not thrown", () => {
    const issues = [
      { message: "dotted key", path: ["user.name"] },
      { message: "bracketed key", path: ["tags[0]"] },
      { message: "negative index", path: ["items", -1, "name"] },
      { message: "fractional index", path: ["items", 1.5] },
    ];
    expect(extractIssues(issues)).toEqual([
      { path: "", message: "dotted key" },
      { path: "", message: "bracketed key" },
      { path: "", message: "negative index" },
      { path: "", message: "fractional index" },
    ]);

    const form = makeForm({ defaultValues: rows });
    expect(applyServerErrors(form, issues)).toEqual({ applied: true, paths: [""] });
    expect(form.formErrors().map((issue) => issue.message)).toEqual([
      "dotted key",
      "bracketed key",
      "negative index",
      "fractional index",
    ]);
  });

  it("[FRM-863] duplicate problems on one field are kept in order: criteriaMode 'all' shows every one, 'firstError' only the first; error() is the first in both", () => {
    const issues = [
      { message: "too short", path: ["items", 0, "name"] },
      { message: "already used", path: ["items", 0, "name"] },
    ];
    for (const criteriaMode of ["all", "firstError"] as const) {
      const form = makeForm({ defaultValues: rows, criteriaMode });
      expect(applyServerErrors(form, issues).paths).toEqual(["items.0.name"]);
      const kept = criteriaMode === "all" ? 2 : 1;
      expect(form.field("items.0.name").errors()).toHaveLength(kept);
      expect(form.field("items.0.name").error()).toBe("too short");
      expect(form.errors()).toEqual({ "items.0.name": "too short" });
      expect(form.isValid()).toBe(false);
    }
    expect(issuesToErrors(extractIssues(issues) ?? [])).toEqual({
      "items.0.name": [{ message: "too short" }, { message: "already used" }],
    });
  });

  it("[FRM-864] a problem for a path no control is bound to is kept on that path, and does not create a value; errors() lists it only when its path maps to a row (a row that does not exist is not listed, but the field handle still holds the problem)", () => {
    const form = makeForm({ defaultValues: rows });
    expect(
      applyServerErrors(form, [
        { message: "late", path: ["late", "field"] },
        { message: "gone", path: ["items", 5, "name"] },
      ]).paths,
    ).toEqual(["late.field", "items.5.name"]);
    expect(form.errors()).toEqual({ "late.field": "late" });
    expect(form.fieldAt("items.5.name").error()).toBe("gone");
    expect(form.fieldAt("late").value()).toBeUndefined();
    expect(form.isValid()).toBe(false);
    form.reset();
    expect(form.errors()).toEqual({});
    expect(form.isValid()).toBe(true);
  });

  it("[FRM-865] a problem for a field that is disabled is kept and blocks validity; the next submit clears it, and the disabled field is left out of the submitted data", async () => {
    const onSubmit = vi.fn();
    const form = makeForm({ defaultValues: { email: "a@b", name: "n" }, onSubmit });
    form.field("email").setDisabled(true);
    applyServerErrors(form, [{ message: "Taken", path: ["email"] }], { focus: false });
    expect(form.field("email").error()).toBe("Taken");
    expect(form.isValid()).toBe(false);

    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect(form.field("email").error()).toBeUndefined();
    expect(form.isValid()).toBe(true);
    const [data] = onSubmit.mock.calls[0] as unknown as [unknown];
    expect(data).toEqual({ name: "n" });
  });
});

describe("initialErrors paths", () => {
  it("[FRM-866] initialErrors in the list form read paths like issues do: {key} steps address the field, and a key with a dot is the form as a whole, not a nested field", () => {
    const form = makeForm({
      defaultValues: { user: { name: "a" }, items: [{ name: "b" }] },
      initialErrors: [
        { message: "Taken", path: [{ key: "items" }, { key: 0 }, { key: "name" }] },
        { message: "Dotted", path: ["user.name"] },
      ],
    });
    expect(form.field("items.0.name").error()).toBe("Taken");
    expect(form.field("user.name").error()).toBeUndefined();
    expect(form.formErrors().map((issue) => issue.message)).toEqual(["Dotted"]);
  });
});
