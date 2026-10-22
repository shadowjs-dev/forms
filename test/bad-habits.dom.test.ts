import { createRoot } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FormApi, useWizard, type WizardApi, type WizardOptions } from "../src/index";
import { makeForm } from "./support/forms";

/**
 * Bad habits in multi-step forms: each test drives the wizard the way a developer often does,
 * then asserts the documented outcome. Storage failures use the console.warn spy from
 * `vitest.setup.ts`; `onStorageError` is the non-warning path. A habit that silently breaks the
 * contract is asserted as it behaves and named as a bug.
 */

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

function validForm(): FormApi<Values> {
  return makeForm<Values>({
    defaultValues: { email: "ada@example.com", name: "Ada", terms: true },
    validators,
  });
}

function emptyEmailForm(): FormApi<Values> {
  return makeForm<Values>({
    defaultValues: { email: "", name: "Ada", terms: true },
    validators,
  });
}

/** Wizard created inside its own owner so `useWizard` has a root. */
function wizardOver(
  form: FormApi<Values>,
  options: Partial<WizardOptions<Values>> = {},
): WizardApi<Values> {
  let wizard: WizardApi<Values> | undefined;
  createRoot(() => {
    wizard = useWizard(form, { steps, ...options });
  });
  if (!wizard) throw new Error("wizard was not created");
  return wizard;
}

/** A Storage stand-in whose writes throw, the way a full quota does. */
function throwingStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: () => null,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    },
  } as Storage;
}

/** Returns the console.warn messages so far and clears the spy, as R-TEST-7 requires. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
  spy.mockClear();
  return messages;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("bad habits: multi-step forms", () => {
  it("[BAD-FRM-01] next() on an invalid step does not move on and returns false", async () => {
    const wizard = wizardOver(emptyEmailForm());
    const moved = await wizard.next();
    expect(moved).toBe(false);
    expect(wizard.index()).toBe(0);
  });

  it("[BAD-FRM-02] next() on the last step with valid fields stays on the last step", async () => {
    const wizard = wizardOver(validForm(), { initialStep: 2 });
    await wizard.next();
    expect(wizard.index()).toBe(2);
    expect(wizard.isLast()).toBe(true);
  });

  it("[BAD-FRM-03] back() on the first step is a silent no-op with no warning", () => {
    const wizard = wizardOver(validForm());
    wizard.back();
    expect(wizard.index()).toBe(0);
    expect(takeWarnings()).toEqual([]);
  });

  it("[BAD-FRM-04] goTo() past an invalid step stops at that step and returns false", async () => {
    const wizard = wizardOver(emptyEmailForm());
    const reached = await wizard.goTo(2);
    expect(reached).toBe(false);
    expect(wizard.index()).toBe(0);
  });

  it("[BAD-FRM-05] goTo() clamps out-of-range targets to the first and last steps", async () => {
    const wizard = wizardOver(validForm());
    await wizard.goTo(99);
    expect(wizard.index()).toBe(2);
    await wizard.goTo(-5);
    expect(wizard.index()).toBe(0);
  });

  it("[BAD-FRM-06] persistKey without a storage option writes the step to sessionStorage", async () => {
    const wizard = wizardOver(validForm(), { persistKey: "signup" });
    await wizard.goTo(1);
    expect(sessionStorage.getItem("signup:step")).toBe("1");
    expect(takeWarnings()).toEqual([]);
  });

  it("[BAD-FRM-07] storage: null disables persistence silently; nothing is written", async () => {
    const wizard = wizardOver(validForm(), { persistKey: "signup", storage: null });
    await wizard.goTo(1);
    expect(sessionStorage.getItem("signup:step")).toBeNull();
    expect(wizard.index()).toBe(1);
    expect(takeWarnings()).toEqual([]);
  });

  it("[BAD-FRM-08] a stored step with four digits is ignored and initialStep wins", () => {
    sessionStorage.setItem("signup:step", "1000");
    const wizard = wizardOver(validForm(), { persistKey: "signup", initialStep: 0 });
    expect(wizard.index()).toBe(0);
  });

  it("[BAD-FRM-09] a stored step beyond the last step is clamped, not rejected", () => {
    sessionStorage.setItem("signup:step", "7");
    const wizard = wizardOver(validForm(), { persistKey: "signup" });
    expect(wizard.index()).toBe(2);
  });

  it("[BAD-FRM-10] onStorageError replaces the default console.warn for a failed save", async () => {
    const failures: unknown[] = [];
    const wizard = wizardOver(validForm(), {
      persistKey: "signup",
      storage: throwingStorage(),
      onStorageError: (error) => failures.push(error),
    });
    await wizard.goTo(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as Error).name).toBe("QuotaExceededError");
    expect(wizard.index()).toBe(1);
    expect(takeWarnings()).toEqual([]);
  });

  it("[BAD-FRM-11] a failed save without onStorageError warns once and keeps the step in memory", async () => {
    const wizard = wizardOver(validForm(), { persistKey: "signup", storage: throwingStorage() });
    await wizard.goTo(1);
    expect(wizard.index()).toBe(1);
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("persistence is off");
  });
});
