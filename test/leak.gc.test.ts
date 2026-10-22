import { createRoot } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import { type FieldArraysApi, type FormApi, useForm } from "../src/index";
import { submitErrors } from "../src/submit-errors";

/** The garbage collector hook; the gc project always runs with --expose-gc. */
function exposedGc(): () => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("the gc project must run with --expose-gc");
  return gc;
}

/** Yields once (WeakRef targets stay alive until the end of the current job), then collects. */
async function collect(): Promise<void> {
  const gc = exposedGc();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  gc();
  gc();
}

/** A value the form cannot copy (a class instance), so a leak of its row keeps it alive. */
class Marker {
  readonly id: number;
  constructor(id: number) {
    this.id = id;
  }
}

interface Row {
  name: string;
  marker: Marker;
}

describe("forms do not leak", () => {
  it("[FRM-270] removed rows, replaced arrays and reset forms release their values", async () => {
    const refs: WeakRef<Marker>[] = [];
    let serial = 0;
    const make = (): Row => {
      serial += 1;
      const id = serial;
      const marker = new Marker(id);
      refs.push(new WeakRef(marker));
      return { name: `n${id}`, marker };
    };
    const form: FormApi<{ rows: Row[] }> & FieldArraysApi<{ rows: Row[] }> = createRoot(() =>
      useForm<{ rows: Row[] }>({
        features: [fieldArrays, asyncValidation, submitErrors],
        id: "leak",
        defaultValues: { rows: [] },
        validators: { "rows.*.name": (value: string) => (value === "" ? "required" : undefined) },
      }),
    );
    const rows = form.fields("rows");
    for (let round = 0; round < 50; round += 1) {
      rows.append(...Array.from({ length: 40 }, make));
      for (let i = 0; i < 40; i += 1) {
        rows.at(i).field("name").setTouched();
        rows.at(i).field("name").setError("x");
      }
      if (round % 3 === 0) rows.replace([make()]);
      else if (round % 3 === 1) rows.remove(Array.from({ length: rows.length() }, (_, i) => i));
      else form.reset();
    }
    // What is still in the form: nothing from the earlier rounds.
    rows.clear();
    // A few rounds: one collection can leave values that a WeakRef still reaches on some engines (Node 22.12 on a loaded runner). A real
    // leak is still there after any number of them.
    let alive = refs.length;
    for (let attempt = 0; attempt < 6 && alive > 0; attempt += 1) {
      await collect();
      alive = refs.filter((ref) => ref.deref() !== undefined).length;
    }
    expect(alive).toBe(0);
    expect(refs.length).toBeGreaterThan(1500);
  });

  it("[FRM-271] a disposed form with pending validation and a submit in flight can be collected", async () => {
    /** Creates the forms in a scope of their own, so no local keeps the last one alive. */
    const spawn = (): WeakRef<object>[] => {
      const refs: WeakRef<object>[] = [];
      for (let i = 0; i < 100; i += 1) {
        const form = createRoot((dispose) => {
          const made = useForm({
            features: [fieldArrays, asyncValidation, submitErrors],
            id: `f${i}`,
            defaultValues: { a: "x", rows: [{ n: 1 }, { n: 2 }] },
            validators: { a: () => new Promise<undefined>(() => undefined) },
            onSubmit: () => new Promise<undefined>(() => undefined),
          });
          made.fields("rows").append({ n: 3 });
          void made.trigger();
          void made.handleSubmit();
          dispose();
          return made;
        });
        refs.push(new WeakRef(form));
      }
      return refs;
    };
    const refs = spawn();
    // The last object a function allocated can stay reachable from a stack slot of the older V8 of Node 22.12 for one
    // collection. A real leak is still there after any number of them, so a few rounds keep the test honest.
    let alive = refs.length;
    for (let round = 0; round < 5 && alive > 0; round += 1) {
      await collect();
      alive = refs.filter((ref) => ref.deref() !== undefined).length;
    }
    expect(alive).toBe(0);
  });
});
