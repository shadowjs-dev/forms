import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sizesOf } from "../src/internal/inspect";
import { makeForm } from "./support/forms";

/** Operations on a list of rows, with positions given as fractions so they are always valid. */
type Op =
  | { op: "append"; n: number }
  | { op: "prepend"; n: number }
  | { op: "insert"; at: number; n: number }
  | { op: "remove"; at: number }
  | { op: "removeMany"; a: number; b: number }
  | { op: "move"; from: number; to: number }
  | { op: "swap"; a: number; b: number }
  | { op: "update"; at: number }
  | { op: "replace"; n: number }
  | { op: "clear" }
  | { op: "touch"; at: number }
  | { op: "fail"; at: number };

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
  fc.record({ op: fc.constant("update" as const), at: frac }),
  fc.record({ op: fc.constant("replace" as const), n: fc.integer({ min: 0, max: 4 }) }),
  fc.record({ op: fc.constant("clear" as const) }),
  fc.record({ op: fc.constant("touch" as const), at: frac }),
  fc.record({ op: fc.constant("fail" as const), at: frac }),
);

/** The model of one row: a plain record that carries what must follow the row. */
interface ModelRow {
  name: string;
  key: string | undefined;
  touched: boolean;
  error: string | undefined;
}

const at = (fraction: number, length: number): number => Math.floor(fraction * length);

describe("array operations against a naive model", () => {
  it("[FRM-122] values, stable keys, touched flags and problems agree with a plain array after any sequence of edits", () => {
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
          const model: ModelRow[] = Array.from({ length: start }, () => ({
            name: fresh(),
            key: undefined,
            touched: false,
            error: undefined,
          }));
          const form = makeForm<{ rows: { name: string }[] }>({
            defaultValues: { rows: model.map((row) => ({ name: row.name })) },
          });
          const rows = form.fields("rows");
          const make = (): ModelRow => ({
            name: fresh(),
            key: undefined,
            touched: false,
            error: undefined,
          });

          const check = (replaced: boolean): void => {
            const keys = rows.keys();
            expect(form.getValues("rows").map((row) => row.name)).toEqual(
              model.map((row) => row.name),
            );
            expect(keys).toHaveLength(model.length);
            expect(new Set(keys).size).toBe(keys.length);
            model.forEach((row, index) => {
              const key = keys[index] as string;
              // Rows that survived keep their key; new rows get a key nobody had.
              if (row.key !== undefined && !replaced) expect(key).toBe(row.key);
              row.key = key;
              const handle = rows.row(key).field("name");
              expect(handle.touched()).toBe(row.touched);
              expect(handle.error()).toBe(row.error);
              expect(rows.row(key).index()).toBe(index);
              expect(rows.row(key).value().name).toBe(row.name);
            });
            // Nothing but the live rows is remembered.
            expect(sizesOf(form)?.recs ?? 0).toBeLessThanOrEqual(model.length + 1);
          };
          check(false);
          for (const step of ops) {
            let replaced = false;
            switch (step.op) {
              case "append": {
                const added = Array.from({ length: step.n }, make);
                rows.append(...added.map((row) => ({ name: row.name })));
                model.push(...added);
                break;
              }
              case "prepend": {
                const added = Array.from({ length: step.n }, make);
                rows.prepend(...added.map((row) => ({ name: row.name })));
                model.unshift(...added);
                break;
              }
              case "insert": {
                const index = at(step.at, model.length + 1);
                const added = Array.from({ length: step.n }, make);
                rows.insert(index, ...added.map((row) => ({ name: row.name })));
                model.splice(index, 0, ...added);
                break;
              }
              case "remove": {
                if (model.length === 0) break;
                const index = at(step.at, model.length);
                rows.remove(index);
                model.splice(index, 1);
                break;
              }
              case "removeMany": {
                if (model.length === 0) break;
                const indices = [...new Set([at(step.a, model.length), at(step.b, model.length)])];
                rows.remove(indices);
                for (const index of [...indices].sort((x, y) => y - x)) model.splice(index, 1);
                break;
              }
              case "move": {
                if (model.length === 0) break;
                const from = at(step.from, model.length);
                const to = at(step.to, model.length);
                rows.move(from, to);
                const [moved] = model.splice(from, 1);
                if (moved !== undefined) model.splice(to, 0, moved);
                break;
              }
              case "swap": {
                if (model.length === 0) break;
                const a = at(step.a, model.length);
                const b = at(step.b, model.length);
                rows.swap(a, b);
                const first = model[a] as ModelRow;
                model[a] = model[b] as ModelRow;
                model[b] = first;
                break;
              }
              case "update": {
                if (model.length === 0) break;
                const index = at(step.at, model.length);
                const row = model[index] as ModelRow;
                row.name = fresh();
                row.error = undefined; // a change clears hand-set problems
                rows.update(index, { name: row.name });
                break;
              }
              case "replace": {
                const added = Array.from({ length: step.n }, make);
                rows.replace(added.map((row) => ({ name: row.name })));
                model.splice(0, model.length, ...added);
                replaced = true;
                break;
              }
              case "clear": {
                rows.clear();
                model.length = 0;
                replaced = true;
                break;
              }
              case "touch": {
                if (model.length === 0) break;
                const index = at(step.at, model.length);
                rows.at(index).field("name").setTouched();
                (model[index] as ModelRow).touched = true;
                break;
              }
              case "fail": {
                if (model.length === 0) break;
                const index = at(step.at, model.length);
                const message = `bad ${(model[index] as ModelRow).name}`;
                rows.at(index).field("name").setError(message);
                (model[index] as ModelRow).error = message;
                break;
              }
            }
            check(replaced);
          }
        },
      ),
      { seed: 42, numRuns: 150 },
    );
  });

  it("[FRM-123] the form works without a DOM: creating, editing and submitting in a node environment", async () => {
    expect(typeof document).toBe("undefined");
    const form = makeForm({
      defaultValues: { a: "x", rows: [{ n: 1 }] },
      validators: { a: (v: string) => (v === "" ? "required" : undefined) },
      onSubmit: () => "ok",
    });
    form.field("a").setValue("");
    form.fields("rows").append({ n: 2 });
    expect(await form.handleSubmit()).toMatchObject({ ok: false, reason: "invalid" });
    expect(form.field("a").error()).toBe("required");
    expect(form.field("rows.1.n").value()).toBe(2);
    expect(form.field("a").props().value).toBe("");
    expect(form.field("a").props()["aria-invalid"]).toBe(true);
  });
});
