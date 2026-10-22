import { flushSync, useEffect } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { FormPathError } from "../src/index";
import { inRoot, makeForm } from "./support/forms";

interface Values {
  name: string;
  age?: number;
  address: { city: string; zip?: string };
  tags: string[];
  emails: { address: string }[];
}

const defaults = (): Values => ({
  name: "Ada",
  address: { city: "London" },
  tags: ["a"],
  emails: [{ address: "ada@x.io" }],
});

describe("values", () => {
  it("[FRM-30] default values are copied: the caller's object is never mutated, getValues is a copy", () => {
    const initial = defaults();
    const form = makeForm<Values>({ defaultValues: initial });
    form.setValue("name", "Grace");
    form.setValue("emails.0.address", "g@x.io");
    expect(initial).toEqual(defaults());
    const copy = form.getValues();
    copy.name = "changed";
    copy.emails[0] = { address: "mutated" };
    expect(form.getValues("name")).toBe("Grace");
    expect(form.getValues("emails.0.address")).toBe("g@x.io");
  });

  it("[FRM-31] a read of values subscribes to exactly the property read", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    let nameRuns = 0;
    let cityRuns = 0;
    inRoot(() => {
      useEffect(() => {
        void form.values.name;
        nameRuns += 1;
      });
      useEffect(() => {
        void form.values.address.city;
        cityRuns += 1;
      });
    });
    flushSync();
    expect([nameRuns, cityRuns]).toEqual([1, 1]);
    form.setValue("name", "Grace");
    flushSync();
    expect([nameRuns, cityRuns]).toEqual([2, 1]);
    form.setValue("address.city", "Paris");
    flushSync();
    expect([nameRuns, cityRuns]).toEqual([2, 2]);
  });

  it("[FRM-32] setValue on a path whose parents are missing or undefined creates them", () => {
    const form = makeForm<Values>({ defaultValues: { name: "x" } as Values });
    form.setValue("address.city", "Oslo");
    form.setValue("emails.1.address", "b@x");
    expect(form.getValues("address")).toEqual({ city: "Oslo" });
    expect(form.getValues("emails")).toEqual([undefined, { address: "b@x" }]);
  });

  it("[FRM-33] setValue accepts an updater that receives a copy of the previous value", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    form.setValue("tags", (previous) => [...previous, "b"]);
    form.setValue("name", (previous) => `${previous}!`);
    expect(form.getValues("tags")).toEqual(["a", "b"]);
    expect(form.getValues("name")).toBe("Ada!");
  });

  it("[FRM-34] setValues merges objects and replaces arrays and leaves", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    form.setValues({ address: { zip: "N1" }, tags: ["z"], name: "Eve" });
    expect(form.getValues()).toEqual({
      name: "Eve",
      address: { city: "London", zip: "N1" },
      tags: ["z"],
      emails: [{ address: "ada@x.io" }],
    });
  });

  it("[FRM-35] watch returns an accessor of one value or of all values", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    const name = form.watch("name");
    const all = form.watch();
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(`${name()}|${all().address.city}`);
      });
    });
    flushSync();
    form.setValue("name", "B");
    flushSync();
    form.setValue("address.city", "C");
    flushSync();
    expect(seen).toEqual(["Ada|London", "B|London", "B|C"]);
  });

  it("[FRM-36] reset restores the defaults; reset(values) adopts new defaults and the form is clean", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    form.setValue("name", "Grace");
    expect(form.isDirty()).toBe(true);
    form.reset();
    expect(form.getValues("name")).toBe("Ada");
    expect(form.isDirty()).toBe(false);
    form.reset({ name: "New", address: { city: "Rome" }, tags: [], emails: [] });
    expect(form.getValues()).toEqual({
      name: "New",
      address: { city: "Rome" },
      tags: [],
      emails: [],
    });
    expect(form.isDirty()).toBe(false);
    form.setValue("name", "Ada");
    expect(form.isDirty()).toBe(true);
    form.reset();
    expect(form.getValues("name")).toBe("New");
  });

  it("[FRM-37] dirty is per field and per form, and reverting a change makes it clean again", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    const name = form.field("name");
    const city = form.field("address.city");
    const address = form.field("address");
    expect([name.dirty(), city.dirty(), address.dirty(), form.isDirty()]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    city.setValue("Paris");
    expect([name.dirty(), city.dirty(), address.dirty(), form.isDirty()]).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(form.dirtyFields()).toEqual(["address.city"]);
    city.setValue("London");
    expect([city.dirty(), address.dirty(), form.isDirty()]).toEqual([false, false, false]);
    expect(form.dirtyFields()).toEqual([]);
  });

  it("[FRM-38] resetField restores one value and clears its state, leaving the rest", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    form.setValue("name", "X");
    form.setValue("address.city", "Y");
    form.field("name").setTouched(true);
    form.resetField("name");
    expect(form.getValues("name")).toBe("Ada");
    expect(form.getValues("address.city")).toBe("Y");
    expect(form.field("name").touched()).toBe(false);
  });

  it.each(["__proto__", "constructor", "prototype", "address.__proto__", "a.constructor.b"])(
    "[FRM-39] reserved key in path %j is refused by field, setValue and getValues",
    (path) => {
      const form = makeForm<Values>({ defaultValues: defaults() });
      expect(() => form.fieldAt(path)).toThrow(FormPathError);
      expect(() => form.setValue(path as never, 1 as never)).toThrow(FormPathError);
      expect(() => form.getValues(path as never)).toThrow(FormPathError);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    },
  );

  it("[FRM-40] sparse default arrays become dense and a write past the end fills with undefined", () => {
    // biome-ignore lint/suspicious/noSparseArray: sparse input is the point
    const form = makeForm<{ rows: (number | undefined)[] }>({ defaultValues: { rows: [1, , 3] } });
    expect(Object.keys(form.getValues("rows"))).toEqual(["0", "1", "2"]);
    form.setValue("rows.5", 9);
    expect(form.getValues("rows")).toEqual([1, undefined, 3, undefined, undefined, 9]);
  });

  it("[FRM-41] touched is per field; an object field is touched when anything in it is", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    const address = form.field("address");
    const city = form.field("address.city");
    expect([city.touched(), address.touched(), form.isTouched()]).toEqual([false, false, false]);
    city.setTouched();
    expect([city.touched(), address.touched(), form.isTouched()]).toEqual([true, true, true]);
    expect(form.touchedFields()).toEqual(["address.city"]);
    city.setTouched(false);
    expect([city.touched(), form.isTouched()]).toEqual([false, false]);
  });

  it("[FRM-42] the same path always returns the same handle; dynamic paths work through fieldAt", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    expect(form.field("emails.0.address")).toBe(form.field("emails.0.address"));
    expect(form.fieldAt("emails[0].address")).toBe(form.field("emails.0.address"));
    expect(form.field("name")).not.toBe(form.field("address.city"));
    expect(form.field("emails.0.address").path).toBe("emails.0.address");
  });

  it("[FRM-43] a keystroke-sized write notifies no other field's readers", () => {
    const form = makeForm<Values>({ defaultValues: defaults() });
    const counts: Record<string, number> = { name: 0, city: 0, tag: 0, email: 0 };
    inRoot(() => {
      const read = (label: string, fn: () => unknown): void =>
        useEffect(() => {
          fn();
          counts[label] = (counts[label] ?? 0) + 1;
        });
      read("name", () => form.field("name").value());
      read("city", () => form.field("address.city").value());
      read("tag", () => form.field("tags.0").value());
      read("email", () => form.field("emails.0.address").value());
    });
    flushSync();
    for (const key of Object.keys(counts)) counts[key] = 0;
    form.field("emails.0.address").setValue("z@z");
    flushSync();
    expect(counts).toEqual({ name: 0, city: 0, tag: 0, email: 1 });
  });
});
