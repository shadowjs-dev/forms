import { flushSync, unwrap, useEffect, useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { useWizard } from "../src/index";
import { sizesOf } from "../src/internal/inspect";
import { inRoot, makeForm, settle } from "./support/forms";
import { type Deferred, deferred } from "./support/schemas";

interface Row {
  name: string;
}

const rawItems = (form: { values: { items: readonly Row[] } }): unknown[] =>
  unwrap(form.values.items);

describe("review round: handles, tracking, wizard", () => {
  it("[FORMS-REV-1] a handle of a removed row is inert: reads see nothing, writes change nothing and no state comes back", () => {
    const form = makeForm<{ items: Row[] }>({
      defaultValues: { items: [{ name: "a" }, { name: "b" }] },
    });
    const items = form.fields("items");
    const row = items.at(0);
    const name = row.field("name");
    name.setError("x");
    row.remove();
    const baseline = sizesOf(form);

    name.setValue("zzz");
    name.setError("late answer from the server");
    name.setTouched();
    name.setDisabled(true);
    name.onBlur();
    name.onFocus();
    expect(name.error()).toBeUndefined();
    expect(name.touched()).toBe(false);
    expect(name.dirty()).toBe(false);
    expect(name.disabled()).toBe(false);
    expect(name.focused()).toBe(false);
    expect(name.validating()).toBe(false);
    expect(name.elements()).toEqual([]);
    expect(row.dirty()).toBe(false);

    expect(form.getValues("items")).toEqual([{ name: "b" }]);
    expect(Reflect.ownKeys(rawItems(form)).map(String)).toEqual(["0", "length"]);
    expect(form.isValid()).toBe(true);
    expect(form.touchedFields()).toEqual([]);
    expect(sizesOf(form)).toEqual(baseline);
  });

  it("[FORMS-REV-1] a removed row's handle can still be asked to validate or reset without touching the list", async () => {
    const form = makeForm<{ items: Row[] }>({
      defaultValues: { items: [{ name: "a" }, { name: "b" }] },
    });
    const items = form.fields("items");
    const name = items.at(0).field("name");
    items.at(0).remove();
    expect(await name.trigger()).toBe(true);
    name.reset();
    name.setValue("late");
    expect(form.getValues("items")).toEqual([{ name: "b" }]);
    expect(Reflect.ownKeys(rawItems(form)).map(String)).toEqual(["0", "length"]);
  });

  it("[FORMS-REV-2] a setValue updater runs untracked: the effect that calls setValue does not subscribe to what the updater reads", () => {
    const form = makeForm<{ n: number }>({ defaultValues: { n: 0 } });
    const [step, setStep] = useSignal(1);
    let runs = 0;
    inRoot(() => {
      useEffect(() => {
        runs += 1;
        form.field("n").setValue((previous) => previous + step());
      });
    });
    flushSync();
    setStep(5);
    flushSync();
    expect(runs).toBe(1);
    expect(form.getValues("n")).toBe(1);
  });

  it("[FORMS-REV-3] resolver, form rule and field validators run untracked: the effect that causes a pass does not subscribe to what they read", () => {
    const [seen, setSeen] = useSignal(0);
    const form = makeForm<{ a: string }>({
      defaultValues: { a: "" },
      validateOn: "change",
      resolver: {
        validate: () => {
          seen();
          return { value: { a: "" } };
        },
      },
      validate: () => {
        seen();
        return undefined;
      },
      validators: {
        a: () => {
          seen();
          return undefined;
        },
      },
    });
    let runs = 0;
    inRoot(() => {
      useEffect(() => {
        runs += 1;
        form.field("a").setValue(`x${runs}`);
      });
    });
    flushSync();
    setSeen(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[FORMS-REV-5] a wizard step that is not a number (NaN) falls back to the first step instead of breaking current()", async () => {
    const form = makeForm<{ a: string }>({ defaultValues: { a: "" } });
    const steps = [
      { id: "one", fields: ["a"] },
      { id: "two", fields: ["a"] },
    ] as const;
    const wizard = inRoot(() => useWizard(form, { steps, initialStep: Number.NaN }));
    expect(wizard.index()).toBe(0);
    expect(wizard.current().id).toBe("one");
    await wizard.next();
    expect(wizard.index()).toBe(1);
    expect(await wizard.goTo(Number.NaN)).toBe(true);
    expect(wizard.index()).toBe(0);
    expect(wizard.current().id).toBe("one");
  });

  it("[FORMS-REV-10] replace() with an item the form refuses leaves the rows and their state as they were", () => {
    const form = makeForm<{ items: Row[] }>({
      defaultValues: { items: [{ name: "a" }, { name: "b" }] },
    });
    const items = form.fields("items");
    const keys = items.keys();
    items.at(0).field("name").setTouched();
    const poisoned = JSON.parse('{"name":"x","__proto__":{"polluted":true}}') as Row;
    expect(() => items.replace([poisoned])).toThrow();
    expect(items.keys()).toEqual(keys);
    expect(items.at(0).field("name").touched()).toBe(true);
    expect(form.getValues("items")).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("[FORMS-REV-11] trigger() does not report a clean form while a newer pass, started by an edit, is still deciding", async () => {
    type Answer = { issues: { path: string[]; message: string }[] } | { value: { user: string } };
    const gates: Deferred<Answer>[] = [];
    const form = makeForm<{ user: string }>({
      defaultValues: { user: "" },
      validateOn: "change",
      resolver: {
        validate: () => {
          const gate = deferred<Answer>();
          gates.push(gate);
          return gate.promise;
        },
      },
    });
    const ok: Answer = { value: { user: "" } };
    const taken: Answer = { issues: [{ path: ["user"], message: "taken" }] };
    gates[0]?.resolve(ok);
    await settle();
    const clean = form.trigger("user");
    form.field("user").setValue("x");
    // The pass the trigger started is now superseded by the edit's pass; its answer is dropped.
    gates[1]?.resolve(ok);
    await settle();
    // Every pass that is still waiting (the edit's, and the one the trigger started again) is taken.
    let answered = 2;
    for (let round = 0; round < 4; round += 1) {
      for (const gate of gates.slice(answered)) gate.resolve(taken);
      answered = gates.length;
      await settle(8);
    }
    expect(await clean).toBe(false);
    expect(form.field("user").error()).toBe("taken");
  });

  it("[FORMS-REV-11] trigger() runs again at most 8 times when a validator keeps changing the values", async () => {
    let manual = 0;
    const form = makeForm<{ n: number }>({
      defaultValues: { n: 0 },
      validators: {
        n: async (_value, context) => {
          await Promise.resolve();
          if (context.trigger === "manual") {
            manual += 1;
            form.setValue("n", manual + 100);
          }
          return undefined;
        },
      },
    });
    expect(await form.trigger("n")).toBe(true);
    expect(manual).toBe(8);
  });
});
