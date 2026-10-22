import { createRoot } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FormApi, useWizard, type WizardApi, type WizardOptions } from "../src/index";
import { makeForm } from "./support/forms";

interface Values {
  email: string;
  name: string;
  terms: boolean;
}

const steps: WizardOptions<Values>["steps"] = [
  { id: "account", fields: ["email"] },
  { id: "profile", fields: ["name"] },
  { id: "confirm", fields: ["terms"] },
];

const validators = {
  email: (value: string) => (value.includes("@") ? undefined : "Needs @"),
  name: (value: string) => (value === "" ? "Required" : undefined),
};

/** A form with valid values, so every step can be passed. */
function validForm(): FormApi<Values> {
  return makeForm<Values>({
    defaultValues: { email: "ada@example.com", name: "Ada", terms: true },
    validators,
  });
}

/** A storage that holds its items in a Map and can be told to fail. */
function memoryStorage(options: { getFails?: boolean; setFails?: boolean } = {}) {
  const items = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      if (options.getFails === true) throw new DOMException("denied", "SecurityError");
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (options.setFails === true) throw new DOMException("quota exceeded", "QuotaExceededError");
      items.set(key, value);
    },
  };
  return { items, storage: storage as unknown as Storage };
}

/** Creates a wizard in an owner, as a component would. */
function wizardOver(
  form: FormApi<Values>,
  options: Partial<WizardOptions<Values>>,
): WizardApi<Values> {
  return createRoot(() => useWizard(form, { steps, ...options }));
}

afterEach(() => {
  sessionStorage.clear();
});

describe("useWizard storage", () => {
  it("[FRM-970] a quota error on save is reported, the wizard still moves, and nothing is remembered", async () => {
    const { items, storage } = memoryStorage({ setFails: true });
    const report = vi.fn();
    const form = validForm();
    const wizard = wizardOver(form, {
      persistKey: "quota",
      storage,
      onStorageError: report,
    });
    expect(await wizard.next()).toBe(true);
    expect(wizard.index()).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toMatchObject({ name: "QuotaExceededError" });
    expect(items.size).toBe(0);
    wizard.back();
    expect(wizard.index()).toBe(0);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("[FRM-971] without onStorageError a refused save is reported with console.warn, once per failure, and nothing else is logged", async () => {
    // The shared setup spies console.warn; the test reads what was logged and clears it.
    const warn = vi.mocked(console.warn);
    const { storage } = memoryStorage({ setFails: true });
    const form = validForm();
    const wizard = wizardOver(form, { persistKey: "quiet", storage });
    await wizard.next();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("persistence is off");
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ name: "QuotaExceededError" });
    warn.mockClear();
  });

  it("[FRM-972] a blocked read falls back to the initial step, is reported once, and later saves still work", async () => {
    const { items, storage } = memoryStorage({ getFails: true });
    const report = vi.fn();
    const form = validForm();
    const wizard = wizardOver(form, {
      persistKey: "blocked",
      storage,
      initialStep: 1,
      onStorageError: report,
    });
    expect(wizard.index()).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toMatchObject({ name: "SecurityError" });
    expect(await wizard.next()).toBe(true);
    expect(items.get("blocked:step")).toBe("2");
  });

  it("[FRM-973] when the storage object cannot be reached at all, the wizard runs in memory and says so", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage is disabled", "SecurityError");
      },
    });
    try {
      const report = vi.fn();
      const form = validForm();
      const wizard = wizardOver(form, { persistKey: "no-storage", onStorageError: report });
      expect(wizard.index()).toBe(0);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0]).toMatchObject({ name: "SecurityError" });
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, "sessionStorage");
      else Object.defineProperty(globalThis, "sessionStorage", original);
    }
  });

  it("[FRM-974] a step saved in session storage is restored by a new form and wizard, and the restored step still validates", async () => {
    const first = validForm();
    const wizard = wizardOver(first, { persistKey: "reload" });
    expect(await wizard.next()).toBe(true);
    expect(sessionStorage.getItem("reload:step")).toBe("1");

    // A reload: a new form with the values the user had (here: only the email), a new wizard.
    const reloaded = makeForm<Values>({
      defaultValues: { email: "ada@example.com", name: "", terms: false },
      validators,
    });
    const restored = wizardOver(reloaded, { persistKey: "reload", initialStep: 0 });
    expect(restored.index()).toBe(1);
    expect(restored.current().id).toBe("profile");
    // The restored step is checked like any other: the name is empty, so it does not pass.
    expect(await restored.next()).toBe(false);
    expect(restored.index()).toBe(1);
    expect(reloaded.errors()).toEqual({ name: "Required" });
  });

  it.each([
    ["", 0],
    [" 1", 0],
    ["1.5", 0],
    ["-1", 0],
    ["1e2", 0],
    ["NaN", 0],
    ["0x1", 0],
    ["9999", 0],
    ["two", 0],
  ])("[FRM-975] a corrupted stored value %j falls back to the first step", (stored, expected) => {
    const { items, storage } = memoryStorage();
    items.set("corrupt:step", stored);
    const wizard = wizardOver(validForm(), { persistKey: "corrupt", storage });
    expect(wizard.index()).toBe(expected);
  });

  it("[FRM-976] a corrupted stored value falls back to the initial step when one is given, and a stored number is clamped", () => {
    const { items, storage } = memoryStorage();
    items.set("fallback:step", "garbage");
    expect(
      wizardOver(validForm(), { persistKey: "fallback", storage, initialStep: 1 }).index(),
    ).toBe(1);
    items.set("fallback:step", "7");
    expect(
      wizardOver(validForm(), { persistKey: "fallback", storage, initialStep: 1 }).index(),
    ).toBe(2);
    items.set("fallback:step", "007");
    expect(wizardOver(validForm(), { persistKey: "fallback", storage }).index()).toBe(2);
  });

  it("[FRM-977] a wizard whose storage fails on every call still navigates in both directions and reports each failed save", async () => {
    const report = vi.fn();
    const { storage } = memoryStorage({ getFails: true, setFails: true });
    const form = validForm();
    const wizard = wizardOver(form, { persistKey: "always", storage, onStorageError: report });
    expect(report).toHaveBeenCalledTimes(1);
    expect(await wizard.next()).toBe(true);
    expect(await wizard.next()).toBe(true);
    expect(wizard.index()).toBe(2);
    wizard.back();
    expect(wizard.index()).toBe(1);
    expect(await wizard.goTo(2)).toBe(true);
    // One report when the storage was read, then one per save: next, next, back, goTo.
    expect(report).toHaveBeenCalledTimes(5);
  });
});
