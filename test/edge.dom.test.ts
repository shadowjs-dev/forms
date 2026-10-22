import { createRoot, flushSync } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import { FormPathError, useForm } from "../src/index";
import { sizesOf } from "../src/internal/inspect";
import { submitErrors } from "../src/submit-errors";
import { MAX_HANDLES } from "../src/use-form";
import { inRoot, makeForm } from "./support/forms";

describe("edge cases", () => {
  it("[FRM-240] a rejected setValues changes nothing, whatever order the paths come in", () => {
    const form = makeForm({ defaultValues: { a: "1", b: { c: "2" } } });
    const hostile = JSON.parse('{"a":"changed","b":{"c":"changed","__proto__":{"x":1}}}');
    expect(() => form.setValues(hostile)).toThrow(FormPathError);
    expect(form.getValues()).toEqual({ a: "1", b: { c: "2" } });
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("[FRM-241] values with dates and files compare by value for dirty checks", () => {
    const file = new File(["x"], "x.txt");
    const form = makeForm<{ when: Date; file?: File }>({
      defaultValues: { when: new Date(1000), file },
    });
    expect(form.isDirty()).toBe(false);
    form.field("when").setValue(new Date(1000));
    expect(form.isDirty()).toBe(false);
    form.field("when").setValue(new Date(2000));
    expect(form.field("when").dirty()).toBe(true);
    form.field("when").setValue(new Date(1000));
    form.field("file").setValue(new File(["x"], "x.txt"));
    expect(form.field("file").dirty()).toBe(true);
    form.field("file").setValue(file);
    expect(form.isDirty()).toBe(false);
  });

  it("[FRM-242] reading and writing through missing intermediates never throws on the read side", () => {
    const form = makeForm<{ a?: { b?: { c?: string } }; list?: { x: number }[] }>({});
    expect(form.getValues("a.b.c")).toBeUndefined();
    expect(form.field("a.b.c").value()).toBeUndefined();
    expect(form.field("list.3.x").value()).toBeUndefined();
    expect(form.field("a.b.c").dirty()).toBe(false);
    expect(form.field("a.b.c").error()).toBeUndefined();
    form.field("a.b.c").setValue("deep");
    expect(form.getValues()).toEqual({ a: { b: { c: "deep" } } });
    form.setValue("list.1.x", 5);
    expect(form.getValues("list")).toEqual([undefined, { x: 5 }]);
    expect(form.field("list.1.x").value()).toBe(5);
  });

  it("[FRM-243] two forms in one page do not share anything, ids included", () => {
    const one = makeForm({ id: "one", defaultValues: { a: "1" } });
    const two = makeForm({ id: "two", defaultValues: { a: "2" } });
    one.field("a").setValue("changed");
    one.field("a").setError("bad");
    expect(two.getValues("a")).toBe("2");
    expect(two.field("a").error()).toBeUndefined();
    expect(one.field("a").id).toBe("one-a");
    expect(two.field("a").id).toBe("two-a");
  });

  it("[FRM-244] a form can be created at module scope (no owner) when it has an id; it needs no cleanup", () => {
    const form = useForm({
      features: [fieldArrays, asyncValidation, submitErrors],
      id: "module",
      defaultValues: { a: "x" },
    });
    form.field("a").setValue("y");
    expect(form.getValues("a")).toBe("y");
    expect(form.id).toBe("module");
    form.dispose();
    form.dispose();
  });

  it("[FRM-245] a form created without an id gets one from the component tree; ids differ between forms", () => {
    const ids = inRoot(() => [
      useForm({ features: [fieldArrays, asyncValidation, submitErrors] }).id,
      useForm({ features: [fieldArrays, asyncValidation, submitErrors] }).id,
    ]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("[FRM-246] validators attached by field() are removed when their owner is disposed", () => {
    const form = makeForm({ defaultValues: { a: "" } });
    createRoot((dispose) => {
      form.field("a", { validate: (v) => (v === "" ? "required" : undefined) });
      expect(sizesOf(form)?.handleValidators).toBe(1);
      dispose();
    });
    expect(sizesOf(form)?.handleValidators).toBe(0);
  });

  it("[FRM-247] handles are cached up to a bound; beyond it the oldest are made again", () => {
    const form = makeForm<Record<string, string>>({ defaultValues: {} });
    const first = form.fieldAt("k0");
    expect(form.fieldAt("k0")).toBe(first);
    for (let i = 1; i <= MAX_HANDLES; i += 1) form.fieldAt(`k${i}`);
    const again = form.fieldAt("k0");
    expect(again).not.toBe(first);
    expect(again.path).toBe("k0");
    expect(form.fieldAt(`k${MAX_HANDLES}`)).toBe(form.fieldAt(`k${MAX_HANDLES}`));
  });

  it("[FRM-248] initialErrors accepts a map or a list of issues and shows them from the start", () => {
    const fromMap = makeForm({
      defaultValues: { a: "", b: "" },
      initialErrors: { a: ["one", { message: "two", type: "custom" }], "": "whole" },
    });
    expect(
      fromMap
        .field("a")
        .errors()
        .map((i) => [i.message, i.type]),
    ).toEqual([
      ["one", "server"],
      ["two", "custom"],
    ]);
    expect(fromMap.formErrors().map((i) => i.message)).toEqual(["whole"]);
    expect(fromMap.isValid()).toBe(false);
    const fromList = makeForm({
      defaultValues: { rows: [{ n: "" }] },
      initialErrors: [{ message: "bad", path: ["rows", 0, "n"] }, { message: "top" }],
    });
    expect(fromList.field("rows.0.n").error()).toBe("bad");
    expect(fromList.formErrors().map((i) => i.message)).toEqual(["top"]);
    fromList.field("rows.0.n").setValue("x");
    expect(fromList.field("rows.0.n").error()).toBeUndefined();
  });

  it("[FRM-249] resetField on a row restores that row's own default, not the one now at its position", () => {
    const form = makeForm<{ rows: { n: string }[] }>({
      defaultValues: { rows: [{ n: "a" }, { n: "b" }] },
    });
    const rows = form.fields("rows");
    const b = rows.at(1);
    b.field("n").setValue("B!");
    rows.move(1, 0);
    expect(b.field("n").value()).toBe("B!");
    b.field("n").reset();
    expect(b.field("n").value()).toBe("b");
    expect(form.getValues("rows")).toEqual([{ n: "b" }, { n: "a" }]);
    expect(b.dirty()).toBe(false);
    rows.append({ n: "new" });
    rows.at(2).field("n").reset();
    expect(rows.at(2).field("n").value()).toBeUndefined();
  });

  it("[FRM-250] rows of primitives work: the row itself is the field", () => {
    const form = makeForm<{ tags: string[] }>({ defaultValues: { tags: ["a", "b"] } });
    const tags = form.fields("tags");
    const second = tags.at(1);
    second.field().setValue("B");
    expect(form.getValues("tags")).toEqual(["a", "B"]);
    tags.swap(0, 1);
    expect(second.field().value()).toBe("B");
    expect(second.index()).toBe(0);
    expect(second.dirty()).toBe(true);
    expect(form.field("tags.0").value()).toBe("B");
  });

  it("[FRM-251] operations on a disposed form do not throw and nothing validates", async () => {
    const form = makeForm({
      defaultValues: { a: "x" },
      validators: { a: () => "bad" },
      validateOn: "change",
    });
    form.dispose();
    form.field("a").setValue("y");
    flushSync();
    expect(form.field("a").error()).toBeUndefined();
    expect(await form.trigger()).toBe(true);
    expect(await form.handleSubmit()).toEqual({ ok: false, reason: "canceled" });
  });

  it("[FRM-252] a field array whose rows are objects with nested arrays keeps each level's keys apart", () => {
    const form = makeForm<{ groups: { name: string; items: { v: string }[] }[] }>({
      defaultValues: {
        groups: [
          { name: "g1", items: [{ v: "a" }] },
          { name: "g2", items: [{ v: "b" }, { v: "c" }] },
        ],
      },
    });
    const groups = form.fields("groups");
    const g2 = groups.at(1);
    const inner = form.fields("groups.1.items");
    expect(inner.keys()).toHaveLength(2);
    inner.at(1).field("v").setError("bad c");
    groups.move(1, 0);
    expect(form.fields("groups.0.items").at(1).field("v").error()).toBe("bad c");
    expect(g2.field("name").value()).toBe("g2");
    groups.remove(1);
    expect(form.isValid()).toBe(false);
    groups.remove(0);
    expect(form.isValid()).toBe(true);
    expect(sizesOf(form)?.recs).toBe(0);
  });

  it("[FRM-253] disposing the owner aborts the pending validator signal and ends the validating state", async () => {
    const signals: AbortSignal[] = [];
    let form: ReturnType<typeof useForm<{ a: string }>> | undefined;
    const dispose = createRoot((stop) => {
      form = useForm<{ a: string }>({
        features: [fieldArrays, asyncValidation, submitErrors],
        id: "owned",
        defaultValues: { a: "" },
        validators: {
          a: (_value: string, context) => {
            signals.push(context.signal);
            return new Promise<undefined>(() => undefined);
          },
        },
      });
      return stop;
    });
    void form?.trigger();
    expect(form?.isValidating()).toBe(true);
    dispose();
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    expect(form?.isValidating()).toBe(false);
  });
});
