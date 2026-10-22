// @vitest-environment happy-dom
import { createRoot } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { useForm } from "../src/index";

/** The garbage collector hook; the gc project always runs with --expose-gc. */
function exposedGc(): () => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("the gc project must run with --expose-gc");
  return gc;
}

/** Yields once (WeakRef targets stay alive until the end of the current job), then collects. */
async function collect(): Promise<void> {
  const gc = exposedGc();
  // Several rounds: older engines (Node 22.12) keep the newest objects alive after the first collections.
  for (let round = 0; round < 6; round += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    gc();
  }
}

/** A value the form cannot copy (a class instance), so a leak of it keeps it alive. */
class Marker {
  readonly id: number;
  constructor(id: number) {
    this.id = id;
  }
}

const COUNT = 1000;

/** The flat values of `COUNT` fields, `f0` to `f999`. */
function fieldDefaults(): Record<string, string> {
  return Object.fromEntries(Array.from({ length: COUNT }, (_, i) => [`f${i}`, ""]));
}

describe("forms do not leak", () => {
  it("[FRM-950] 1,000 fields with validators, created in a component and disposed, release their validators and values", async () => {
    const markers: WeakRef<Marker>[] = [];
    const forms: WeakRef<object>[] = [];
    for (let round = 0; round < 3; round += 1) {
      createRoot((dispose) => {
        const form = useForm<Record<string, string>>({
          id: `mount-${round}`,
          defaultValues: fieldDefaults(),
        });
        forms.push(new WeakRef(form));
        for (let i = 0; i < COUNT; i += 1) {
          const marker = new Marker(round * COUNT + i);
          markers.push(new WeakRef(marker));
          // Each field gets its own validator closure that captures the marker.
          form.field(`f${i}`, {
            validate: (value: string) => (value === marker.id.toString() ? "same" : undefined),
          });
          form.setValue(`f${i}`, `v${i}`);
        }
        expect(form.getValues("f0")).toBe("v0");
        expect(form.getValues("f999")).toBe("v999");
        dispose();
      });
    }
    await collect();
    expect(markers.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
    expect(forms.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });

  it("[FRM-951] 1,000 bound controls of a disposed form are released with their elements", async () => {
    const elements: WeakRef<HTMLInputElement>[] = [];
    createRoot((dispose) => {
      const form = useForm<Record<string, string>>({
        id: "bound",
        defaultValues: fieldDefaults(),
      });
      for (let i = 0; i < COUNT; i += 1) {
        const input = document.createElement("input");
        elements.push(new WeakRef(input));
        // Binds the control the way `ref={...}` does; the element is never inserted in a document.
        form.field(`f${i}`).props().ref(input);
      }
      dispose();
    });
    await collect();
    expect(elements.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });

  it("[FRM-952] 200 forms created and disposed in a loop are all collected", async () => {
    const forms: WeakRef<object>[] = [];
    for (let i = 0; i < 200; i += 1) {
      createRoot((dispose) => {
        const form = useForm<{ a: string; b: string[] }>({
          id: `loop-${i}`,
          defaultValues: { a: "x", b: ["y"] },
          validators: { a: (value: string) => (value === "" ? "required" : undefined) },
        });
        forms.push(new WeakRef(form));
        void form.trigger();
        form.setValue("a", "");
        dispose();
      });
    }
    await collect();
    expect(forms.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
  });
});
