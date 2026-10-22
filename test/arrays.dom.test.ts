import { flushSync, useEffect } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sizesOf } from "../src/internal/inspect";
import { standardSchema } from "../src/standard-schema";
import { inRoot, makeForm } from "./support/forms";

interface Item {
  name: string;
  tags?: string[];
}
interface Values {
  items: Item[];
}

const item = (name: string): Item => ({ name });
const names = (form: { getValues(path: "items"): Item[] }): string[] =>
  form.getValues("items").map((row) => row.name);

function listForm(...initial: string[]) {
  return makeForm<Values>({ defaultValues: { items: initial.map(item) } });
}

describe("field array helpers", () => {
  it("[FRM-110] append, prepend, insert, remove, move, swap, update, replace and clear edit the values", () => {
    const form = listForm("a", "b", "c");
    const items = form.fields("items");
    items.append(item("d"), item("e"));
    expect(names(form)).toEqual(["a", "b", "c", "d", "e"]);
    items.prepend(item("z"));
    expect(names(form)).toEqual(["z", "a", "b", "c", "d", "e"]);
    items.insert(2, item("m"));
    expect(names(form)).toEqual(["z", "a", "m", "b", "c", "d", "e"]);
    items.remove(2);
    items.remove([0, 5]);
    expect(names(form)).toEqual(["a", "b", "c", "d"]);
    items.move(0, 3);
    expect(names(form)).toEqual(["b", "c", "d", "a"]);
    items.swap(0, 3);
    expect(names(form)).toEqual(["a", "c", "d", "b"]);
    items.update(1, item("C"));
    expect(names(form)).toEqual(["a", "C", "d", "b"]);
    items.replace([item("x"), item("y")]);
    expect(names(form)).toEqual(["x", "y"]);
    items.clear();
    expect(form.getValues("items")).toEqual([]);
    expect(items.length()).toBe(0);
  });

  it("[FRM-111] rows keep their key while others are added, removed or moved; new rows get new keys", () => {
    const form = listForm("a", "b", "c");
    const items = form.fields("items");
    const [ka, kb, kc] = items.keys() as [string, string, string];
    expect(new Set([ka, kb, kc]).size).toBe(3);
    items.prepend(item("z"));
    items.insert(2, item("m"));
    items.remove(0);
    expect(items.keys()).toEqual([ka, expect.any(String), kb, kc]);
    items.move(3, 0);
    expect(items.keys()).toEqual([kc, ka, expect.any(String), kb]);
    expect(items.row(kc).value().name).toBe("c");
    expect(items.row(kc).index()).toBe(0);
    expect(items.at(3).key).toBe(kb);
    expect(() => items.row("r-nope")).toThrow(RangeError);
    expect(() => items.at(9)).toThrow(RangeError);
  });

  it("[FRM-112] a row's touched flag, problem and dirty state follow the row, not the position", async () => {
    const schema = z.object({ items: z.array(z.object({ name: z.string().min(2, "too short") })) });
    const form = makeForm({
      resolver: standardSchema(schema),
      defaultValues: { items: [{ name: "ab" }, { name: "x" }, { name: "cd" }] },
    });
    const items = form.fields("items");
    const bad = items.at(1);
    bad.field("name").setTouched();
    await form.trigger();
    expect(bad.field("name").error()).toBe("too short");
    items.prepend({ name: "new" });
    items.move(0, 3);
    items.swap(0, 2);
    items.remove(0);
    expect(bad.index()).toBe(0);
    expect(bad.field("name").touched()).toBe(true);
    expect(bad.field("name").error()).toBe("too short");
    expect(bad.field("name").path).toBe(`items.${bad.index()}.name`);
    expect(form.errors()).toEqual({ [`items.${bad.index()}.name`]: "too short" });
    // Dirty is against the row's own default: untouched rows are clean wherever they ended up.
    expect(items.at(0).dirty()).toBe(false);
    expect(bad.dirty()).toBe(false);
    bad.field("name").setValue("xy");
    expect(bad.dirty()).toBe(true);
    expect(bad.field("name").dirty()).toBe(true);
    expect(items.row(items.keys()[items.length() - 1] as string).isNew()).toBe(true);
    expect(bad.isNew()).toBe(false);
  });

  it("[FRM-113] index-addressed fields resolve through rows, so they follow moves too", async () => {
    const form = listForm("a", "b");
    const second = form.field("items.1.name");
    form.field("items.1.name").setError("bad b");
    expect(second.error()).toBe("bad b");
    form.fields("items").swap(0, 1);
    expect(second.error()).toBeUndefined();
    expect(form.field("items.0.name").error()).toBe("bad b");
    expect(second.value()).toBe("a");
  });

  it("[FRM-114] removing rows deletes their state: nothing accumulates", async () => {
    const form = makeForm<Values>({ defaultValues: { items: [] } });
    const items = form.fields("items");
    items.keys();
    const baseline = sizesOf(form);
    for (let round = 0; round < 3; round += 1) {
      items.append(...Array.from({ length: 200 }, (_, i) => item(`n${i}`)));
      for (let i = 0; i < 200; i += 1) {
        const row = items.at(i);
        row.field("name").setTouched();
        row.field("name").setError("x");
      }
      expect(form.touchedFields()).toHaveLength(200);
      items.remove(Array.from({ length: 200 }, (_, i) => i));
    }
    expect(form.touchedFields()).toEqual([]);
    expect(form.isTouched()).toBe(false);
    expect(form.isValid()).toBe(true);
    expect(sizesOf(form)).toEqual(baseline);
  });

  it("[FRM-115] nested arrays: removing an outer row drops the state of the rows inside it", () => {
    const form = makeForm<{ groups: { tags: { v: string }[] }[] }>({
      defaultValues: { groups: [{ tags: [{ v: "a" }] }, { tags: [{ v: "b" }, { v: "c" }] }] },
    });
    const groups = form.fields("groups");
    const baseline = sizesOf(form);
    const inner = groups.at(1).field("tags").value();
    expect(inner).toHaveLength(2);
    form.field("groups.1.tags.0.v").setTouched();
    form.field("groups.1.tags.1.v").setError("x");
    expect(form.touchedFields()).toEqual(["groups.1.tags.0.v"]);
    groups.remove(1);
    expect(form.touchedFields()).toEqual([]);
    expect(form.isValid()).toBe(true);
    expect(sizesOf(form)?.rows).toBeLessThanOrEqual((baseline?.rows ?? 0) + 1);
    groups.append({ tags: [] });
    expect(form.getValues("groups")).toEqual([{ tags: [{ v: "a" }] }, { tags: [] }]);
  });

  it("[FRM-116] replace, setValue on the array and reset give the rows new keys", () => {
    const form = listForm("a", "b");
    const items = form.fields("items");
    const before = items.keys();
    items.replace([item("a"), item("b")]);
    expect(items.keys().some((key) => before.includes(key))).toBe(false);
    const afterReplace = items.keys();
    form.setValue("items", [item("q")]);
    expect(items.keys()).toHaveLength(1);
    expect(afterReplace.includes(items.keys()[0] as string)).toBe(false);
    form.reset();
    expect(names(form)).toEqual(["a", "b"]);
    expect(items.keys()).toHaveLength(2);
  });

  it("[FRM-117] invalid indices throw RangeError, a path that is not an array throws TypeError, nothing changes", () => {
    const form = makeForm<{ items: Item[]; name: string }>({
      defaultValues: { items: [item("a")], name: "x" },
    });
    const items = form.fields("items");
    expect(() => items.insert(5, item("z"))).toThrow(RangeError);
    expect(() => items.insert(-1, item("z"))).toThrow(RangeError);
    expect(() => items.remove(3)).toThrow(RangeError);
    expect(() => items.move(0, 4)).toThrow(RangeError);
    expect(() => items.swap(0, 1)).toThrow(RangeError);
    expect(() => items.update(2, item("z"))).toThrow(RangeError);
    expect(() => items.insert(0.5, item("z"))).toThrow(RangeError);
    expect(() => form.fields("name" as never).append("x" as never)).toThrow(TypeError);
    expect(names(form)).toEqual(["a"]);
    expect(() => form.fields("__proto__" as never)).toThrow();
  });

  it("[FRM-118] an array that does not exist yet is created by append; length and keys are empty before", () => {
    const form = makeForm<{ items?: Item[] }>({});
    const items = form.fields("items" as never) as unknown as ReturnType<
      typeof form.fields<"items">
    >;
    expect(items.length()).toBe(0);
    expect(items.keys()).toEqual([]);
    items.append(item("first"));
    expect(form.getValues("items")).toEqual([{ name: "first" }]);
    expect(items.keys()).toHaveLength(1);
  });

  it("[FRM-119] an array-level validator sees structural edits (at least one row)", async () => {
    const form = makeForm<Values>({
      defaultValues: { items: [item("a")] },
      validators: { items: (value: Item[]) => (value.length < 1 ? "Add at least one" : undefined) },
      validateOn: "change",
    });
    form.fields("items").remove(0);
    expect(form.field("items").error()).toBe("Add at least one");
    form.fields("items").append(item("b"));
    expect(form.field("items").error()).toBeUndefined();
  });

  it("[FRM-120] moving a row re-numbers only the rows between the two positions (O(changed))", () => {
    const form = makeForm<Values>({
      defaultValues: { items: Array.from({ length: 300 }, (_, i) => item(`n${i}`)) },
    });
    const items = form.fields("items");
    const runs = new Map<string, number>();
    inRoot(() => {
      for (const key of items.keys()) {
        const row = items.row(key);
        useEffect(() => {
          row.index();
          runs.set(key, (runs.get(key) ?? 0) + 1);
        });
      }
    });
    flushSync();
    runs.clear();
    items.move(100, 103);
    flushSync();
    expect(runs.size).toBe(4);
    runs.clear();
    items.swap(10, 12);
    flushSync();
    // Positions 10 and 12 change; 11 keeps its number and is not notified.
    expect(runs.size).toBe(2);
    runs.clear();
    items.remove(299);
    flushSync();
    expect(runs.size).toBe(1);
    runs.clear();
    items.append(item("end"));
    flushSync();
    expect(runs.size).toBe(0);
  });

  it("[FRM-121] each() keeps a row's output while the list changes and follows the index", () => {
    const form = listForm("a", "b", "c");
    const items = form.fields("items");
    const made: string[] = [];
    const out = inRoot(() =>
      items.each((row, index) => {
        made.push(row.field("name").value());
        return { key: row.key, index };
      }),
    );
    flushSync();
    const first = out();
    expect(made).toEqual(["a", "b", "c"]);
    items.move(0, 2);
    flushSync();
    const second = out();
    expect(made).toEqual(["a", "b", "c"]);
    expect(second.map((r) => r.key)).toEqual([first[1]?.key, first[2]?.key, first[0]?.key]);
    expect(second.map((r) => r.index())).toEqual([0, 1, 2]);
    items.prepend(item("n"));
    flushSync();
    out();
    expect(made).toEqual(["a", "b", "c", "n"]);
  });
});
