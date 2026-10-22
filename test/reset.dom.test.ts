import { describe, expect, it } from "vitest";
import type { ResetOptions } from "../src/index";
import { makeForm, settle } from "./support/forms";

interface Form {
  name: string;
  items: { name: string }[];
}

const base = (): Form => ({ name: "ann", items: [{ name: "a" }, { name: "b" }] });

describe("reset", () => {
  it("[FRM-720] reset() with no argument returns the values, the rows and their state to the defaults, under new keys", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    const items = form.fields("items");
    const old = items.keys();
    form.field("name").setValue("bo");
    items.at(0).field("name").setValue("x");
    items.at(0).field("name").setError("bad");
    items.at(1).field("name").setTouched();
    items.prepend({ name: "n" });
    form.reset();
    expect(form.getValues()).toEqual(base());
    expect(items.keys()).toHaveLength(2);
    expect(items.keys().some((key) => old.includes(key))).toBe(false);
    expect(form.isDirty()).toBe(false);
    expect(form.dirtyFields()).toEqual([]);
    expect(form.touchedFields()).toEqual([]);
    expect(form.errors()).toEqual({});
    expect(form.isTouched()).toBe(false);
  });

  it("[FRM-721] reset(values) makes the values the new defaults: pristine after it, and reset() goes back to them", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    form.reset({ name: "bo", items: [{ name: "x" }] });
    expect(form.getValues()).toEqual({ name: "bo", items: [{ name: "x" }] });
    expect(form.isDirty()).toBe(false);
    expect(form.dirtyFields()).toEqual([]);
    form.field("name").setValue("bo2");
    expect(form.isDirty()).toBe(true);
    expect(form.dirtyFields()).toEqual(["name"]);
    form.reset();
    expect(form.getValues()).toEqual({ name: "bo", items: [{ name: "x" }] });
    expect(form.isDirty()).toBe(false);
  });

  it("[FRM-722] reset(values, { keepDefaultValues: true }) changes the values but keeps the old baseline; reset() then returns to that baseline", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    form.reset({ name: "bo", items: [{ name: "x" }] }, { keepDefaultValues: true });
    expect(form.getValues()).toEqual({ name: "bo", items: [{ name: "x" }] });
    expect(form.isDirty()).toBe(true);
    expect(form.dirtyFields()).toEqual(expect.arrayContaining(["name", "items.0.name"]));
    form.reset();
    expect(form.getValues()).toEqual(base());
    expect(form.isDirty()).toBe(false);
  });

  it.each<ResetOptions>([{ keepDefaultValues: true }, { keepDirty: true }])(
    "[FRM-723] the baseline option %j keeps the old defaults: the same values, the same dirty answers",
    (options) => {
      const form = makeForm<Form>({ defaultValues: base() });
      form.reset({ name: "bo", items: base().items }, options);
      expect(form.isDirty()).toBe(true);
      expect(form.dirtyFields()).toEqual(["name"]);
      expect(form.field("name").dirty()).toBe(true);
      expect(form.field("items").dirty()).toBe(false);
    },
  );

  it("[FRM-724] keepValues keeps the values and the rows, and the new values become the baseline", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    const items = form.fields("items");
    form.field("name").setValue("x");
    const keys = items.keys();
    form.reset({ name: "y", items: base().items }, { keepValues: true });
    expect(form.getValues("name")).toBe("x");
    expect(items.keys()).toEqual(keys);
    expect(form.getValues("items")).toEqual(base().items);
    expect(form.isDirty()).toBe(true);
    form.field("name").setValue("y");
    expect(form.isDirty()).toBe(false);
    expect(form.dirtyFields()).toEqual([]);
  });

  it("[FRM-725] keepErrors keeps the problems and keepTouched keeps the touched flags of fields outside the arrays; a reset replaces the rows, so the state inside a row does not survive it", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    form.field("name").setError("bad");
    form.field("items.1.name").setError("bad row");
    form.reset(undefined, { keepErrors: true });
    expect(form.errors()).toEqual({ name: "bad" });

    form.field("name").setTouched();
    form.field("items.1.name").setTouched();
    form.reset(undefined, { keepTouched: true });
    expect(form.touchedFields()).toEqual(["name"]);

    form.field("name").setTouched();
    form.reset();
    expect(form.touchedFields()).toEqual([]);
  });

  it("[FRM-726] keepSubmitCount, keepIsSubmitted and keepIsSubmitSuccessful keep their own answer and nothing else", async () => {
    const make = () => makeForm<Form>({ defaultValues: base(), onSubmit: () => "ok" });

    const plain = make();
    await plain.handleSubmit();
    expect([plain.submitCount(), plain.isSubmitted(), plain.isSubmitSuccessful()]).toEqual([
      1,
      true,
      true,
    ]);
    plain.reset();
    expect([plain.submitCount(), plain.isSubmitted(), plain.isSubmitSuccessful()]).toEqual([
      0,
      false,
      false,
    ]);

    const count = make();
    await count.handleSubmit();
    count.reset(undefined, { keepSubmitCount: true });
    expect([count.submitCount(), count.isSubmitted(), count.isSubmitSuccessful()]).toEqual([
      1,
      false,
      false,
    ]);

    const submitted = make();
    await submitted.handleSubmit();
    submitted.reset(undefined, { keepIsSubmitted: true });
    expect([
      submitted.submitCount(),
      submitted.isSubmitted(),
      submitted.isSubmitSuccessful(),
    ]).toEqual([0, true, false]);

    const successful = make();
    await successful.handleSubmit();
    successful.reset(undefined, { keepIsSubmitSuccessful: true });
    expect([
      successful.submitCount(),
      successful.isSubmitted(),
      successful.isSubmitSuccessful(),
    ]).toEqual([0, false, true]);
  });

  it("[FRM-727] a reset while a submit is pending cancels it: its handler's result changes nothing, and the form can submit again", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const form = makeForm<Form>({
      defaultValues: base(),
      onSubmit: async () => {
        calls += 1;
        await gate;
        return "done";
      },
    });
    form.field("name").setValue("changed");
    const pending = form.handleSubmit();
    expect(form.isSubmitting()).toBe(true);
    form.reset();
    expect(form.isSubmitting()).toBe(false);
    expect(form.getValues("name")).toBe("ann");
    release();
    expect(await pending).toEqual({ ok: false, reason: "canceled" });
    await settle();
    expect(form.isSubmitting()).toBe(false);
    expect(form.isSubmitSuccessful()).toBe(false);
    expect(form.isSubmitted()).toBe(false);
    expect(form.submitError()).toBeUndefined();
    expect(form.getValues()).toEqual(base());
    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect(calls).toBe(2);
  });

  it("[FRM-728] resetField restores one field and clears its state; the rest of the form and the row keys stay", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    const items = form.fields("items");
    const keys = items.keys();
    form.field("name").setValue("bo");
    form.field("name").setTouched();
    form.field("items.1.name").setValue("B");
    form.field("items.1.name").setTouched();
    form.field("items.1.name").setError("bad");
    form.resetField("items.1.name");
    expect(form.getValues("items.1.name")).toBe("b");
    expect(form.field("items.1.name").touched()).toBe(false);
    expect(form.field("items.1.name").error()).toBeUndefined();
    expect(form.getValues("name")).toBe("bo");
    expect(form.touchedFields()).toEqual(["name"]);
    expect(items.keys()).toEqual(keys);
  });

  it("[FRM-729] resetField of a moved row restores its own default (its origin among the defaults), not the default of the index it now has", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    // Move "b" (default index 1) to the front: the default at index 0 is "a", but "b" must come back as "b".
    form.fields("items").move(1, 0);
    expect(form.getValues("items")).toEqual([{ name: "b" }, { name: "a" }]);
    form.field("items.0.name").setValue("B");
    form.resetField("items.0.name");
    expect(form.getValues("items.0.name")).toBe("b");
    expect(form.getValues("items.1.name")).toBe("a");
  });

  it("[FRM-730] resetField of an array path restores its default rows under new keys and drops the state of every row", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    const items = form.fields("items");
    const keys = items.keys();
    items.at(1).field("name").setTouched();
    items.at(1).field("name").setError("bad");
    items.append({ name: "c" });
    form.resetField("items");
    expect(form.getValues("items")).toEqual(base().items);
    expect(items.keys()).toHaveLength(2);
    expect(items.keys().some((key) => keys.includes(key))).toBe(false);
    expect(form.touchedFields()).toEqual([]);
    expect(form.errors()).toEqual({});
    expect(form.isDirty()).toBe(false);
  });

  it("[FRM-731] reset(values) with a different number of rows: the rows are the new ones and a handle to a removed row reports -1", () => {
    const form = makeForm<Form>({ defaultValues: base() });
    const items = form.fields("items");
    const stale = items.at(0);
    form.reset({ name: "ann", items: [{ name: "only" }] });
    expect(items.length()).toBe(1);
    expect(items.keys()).toHaveLength(1);
    expect(stale.index()).toBe(-1);
    expect(items.keys()).not.toContain(stale.key);
  });
});
