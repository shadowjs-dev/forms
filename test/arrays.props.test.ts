import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeForm } from "./support/forms";

/** Operations on the list of names, with positions as fractions so every one is valid. */
type Op =
  | { op: "append"; n: number }
  | { op: "prepend"; n: number }
  | { op: "insert"; at: number; n: number }
  | { op: "remove"; at: number }
  | { op: "removeMany"; a: number; b: number }
  | { op: "move"; from: number; to: number }
  | { op: "swap"; a: number; b: number }
  | { op: "edit"; at: number }
  | { op: "replace"; n: number }
  | { op: "clear" };

const frac = fc.double({ min: 0, max: 0.999, noNaN: true });
const count = fc.integer({ min: 1, max: 3 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("append" as const), n: count }),
  fc.record({ op: fc.constant("prepend" as const), n: count }),
  fc.record({ op: fc.constant("insert" as const), at: frac, n: count }),
  fc.record({ op: fc.constant("remove" as const), at: frac }),
  fc.record({ op: fc.constant("removeMany" as const), a: frac, b: frac }),
  fc.record({ op: fc.constant("move" as const), from: frac, to: frac }),
  fc.record({ op: fc.constant("swap" as const), a: frac, b: frac }),
  fc.record({ op: fc.constant("edit" as const), at: frac }),
  fc.record({ op: fc.constant("replace" as const), n: fc.integer({ min: 0, max: 4 }) }),
  fc.record({ op: fc.constant("clear" as const) }),
);

const at = (fraction: number, length: number): number => Math.floor(fraction * length);
const sameNames = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

describe("field array operations against a plain array model", () => {
  it("[FRM-700] after any sequence of edits the values equal the model, isDirty agrees with it, and a dirty form always lists a dirty path; reset returns to the defaults", () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { maxLength: 40 }),
        fc.integer({ min: 0, max: 4 }),
        (ops, start) => {
          let serial = 0;
          const fresh = (): string => {
            serial += 1;
            return `n${serial}`;
          };
          const initial = Array.from({ length: start }, () => fresh());
          const form = makeForm<{ items: { name: string }[] }>({
            defaultValues: { items: initial.map((name) => ({ name })) },
          });
          const items = form.fields("items");
          let model: string[] = initial.slice();
          const toItems = (names: readonly string[]): { name: string }[] =>
            names.map((name) => ({ name }));

          const check = (): void => {
            expect(form.getValues("items").map((row) => row.name)).toEqual(model);
            expect(new Set(items.keys()).size).toBe(model.length);
            // Whole-form dirty is the comparison with the defaults, so it must match the model.
            expect(form.isDirty()).toBe(!sameNames(model, initial));
            // isDirty and dirtyFields agree both ways: a clean form names no path, a dirty one names one.
            expect(form.dirtyFields().length > 0).toBe(form.isDirty());
          };
          check();
          const keysBefore = new Set(items.keys());

          for (const step of ops) {
            switch (step.op) {
              case "append": {
                const added = Array.from({ length: step.n }, fresh);
                items.append(...toItems(added));
                model = [...model, ...added];
                break;
              }
              case "prepend": {
                const added = Array.from({ length: step.n }, fresh);
                items.prepend(...toItems(added));
                model = [...added, ...model];
                break;
              }
              case "insert": {
                const index = at(step.at, model.length + 1);
                const added = Array.from({ length: step.n }, fresh);
                items.insert(index, ...toItems(added));
                model = [...model.slice(0, index), ...added, ...model.slice(index)];
                break;
              }
              case "remove": {
                if (model.length === 0) break;
                const index = at(step.at, model.length);
                items.remove(index);
                model = model.filter((_, position) => position !== index);
                break;
              }
              case "removeMany": {
                if (model.length === 0) break;
                const indices = [...new Set([at(step.a, model.length), at(step.b, model.length)])];
                items.remove(indices);
                model = model.filter((_, position) => !indices.includes(position));
                break;
              }
              case "move": {
                if (model.length === 0) break;
                const from = at(step.from, model.length);
                const to = at(step.to, model.length);
                items.move(from, to);
                const rest = model.filter((_, position) => position !== from);
                const moved = model[from] as string;
                model = [...rest.slice(0, to), moved, ...rest.slice(to)];
                break;
              }
              case "swap": {
                if (model.length === 0) break;
                const a = at(step.a, model.length);
                const b = at(step.b, model.length);
                items.swap(a, b);
                const next = model.slice();
                next[a] = model[b] as string;
                next[b] = model[a] as string;
                model = next;
                break;
              }
              case "edit": {
                if (model.length === 0) break;
                const index = at(step.at, model.length);
                const name = fresh();
                items.at(index).field("name").setValue(name);
                model = model.map((entry, position) => (position === index ? name : entry));
                break;
              }
              case "replace": {
                const added = Array.from({ length: step.n }, fresh);
                items.replace(toItems(added));
                model = added;
                break;
              }
              case "clear": {
                items.clear();
                model = [];
                break;
              }
            }
            check();
          }

          // Reset returns every row to the defaults under new keys, and the form is clean again.
          form.reset();
          expect(form.getValues("items").map((row) => row.name)).toEqual(initial);
          expect(form.isDirty()).toBe(false);
          expect(form.dirtyFields()).toEqual([]);
          expect(items.keys().some((key) => keysBefore.has(key))).toBe(false);
        },
      ),
      { seed: 42, numRuns: 150 },
    );
  });
});
