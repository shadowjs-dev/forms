import { flushSync, useEffect } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { useWizard } from "../src/index";
import { inRoot, makeForm } from "./support/forms";

interface Values {
  email: string;
  password: string;
  profile: { first: string; last: string };
  terms: boolean;
}

const rules = {
  email: (v: string) => (v.includes("@") ? undefined : "Needs @"),
  password: (v: string) => (v.length >= 4 ? undefined : "Too short"),
  "profile.first": (v: string) => (v === "" ? "First required" : undefined),
  "profile.last": (v: string) => (v === "" ? "Last required" : undefined),
};

const create = () =>
  makeForm<Values>({
    defaultValues: { email: "", password: "", profile: { first: "", last: "" }, terms: false },
    validators: rules,
  });

const steps = [
  { id: "account", fields: ["email", "password"] },
  { id: "profile", fields: ["profile"] },
  { id: "confirm", fields: ["terms"] },
] as const;

describe("useWizard", () => {
  it("[FRM-210] next validates only the current step, shows only its problems, and stays on a failing step", async () => {
    const form = create();
    const wizard = inRoot(() => useWizard(form, { steps }));
    expect(wizard.index()).toBe(0);
    expect(await wizard.next()).toBe(false);
    expect(wizard.index()).toBe(0);
    expect(form.errors()).toEqual({ email: "Needs @", password: "Too short" });
    form.setValues({ email: "a@b", password: "abcd" });
    expect(await wizard.next()).toBe(true);
    expect(wizard.index()).toBe(1);
    expect(wizard.current().id).toBe("profile");
    expect(form.errors()).toEqual({});
  });

  it("[FRM-211] a step may name an object: everything inside it is checked", async () => {
    const form = create();
    const wizard = inRoot(() => useWizard(form, { steps, initialStep: 1 }));
    expect(await wizard.next()).toBe(false);
    expect(form.errors()).toEqual({
      "profile.first": "First required",
      "profile.last": "Last required",
    });
    form.setValue("profile.first", "Ada");
    expect(form.field("profile.first").error()).toBeUndefined();
    form.setValue("profile.last", "L");
    expect(await wizard.next()).toBe(true);
  });

  it("[FRM-212] back never validates; goTo an earlier step is free, a later one needs the steps before it to be clean", async () => {
    const form = create();
    const wizard = inRoot(() => useWizard(form, { steps, initialStep: 2 }));
    wizard.back();
    expect(wizard.index()).toBe(1);
    expect(form.errors()).toEqual({});
    expect(await wizard.goTo(0)).toBe(true);
    expect(wizard.index()).toBe(0);
    expect(await wizard.goTo(2)).toBe(false);
    expect(wizard.index()).toBe(0);
    form.setValues({ email: "a@b", password: "abcd" });
    expect(await wizard.goTo(2)).toBe(false);
    expect(wizard.index()).toBe(1);
    form.setValues({ profile: { first: "A", last: "B" } });
    expect(await wizard.goTo(2)).toBe(true);
    expect(wizard.index()).toBe(2);
    expect(await wizard.goTo(99)).toBe(true);
    expect(wizard.index()).toBe(2);
    wizard.back();
    wizard.back();
    wizard.back();
    expect(wizard.index()).toBe(0);
  });

  it("[FRM-213] isFirst and isLast are reactive; next on the last step reports clean without moving", async () => {
    const form = create();
    form.setValues({ email: "a@b", password: "abcd", profile: { first: "A", last: "B" } });
    const wizard = inRoot(() => useWizard(form, { steps }));
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(`${wizard.index()}:${wizard.isFirst()}:${wizard.isLast()}`);
      });
    });
    flushSync();
    await wizard.next();
    await wizard.next();
    flushSync();
    expect(await wizard.next()).toBe(true);
    expect(wizard.index()).toBe(2);
    expect(seen).toEqual(["0:true:false", "1:false:false", "2:false:true"]);
  });

  it("[FRM-214] the step is remembered in storage, clamped on restore, and storage failures are reported", async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as unknown as Storage;
    const form = create();
    form.setValues({ email: "a@b", password: "abcd" });
    const first = inRoot(() => useWizard(form, { steps, persistKey: "signup", storage }));
    await first.next();
    expect(store.get("signup:step")).toBe("1");
    const restored = inRoot(() => useWizard(form, { steps, persistKey: "signup", storage }));
    expect(restored.index()).toBe(1);
    store.set("signup:step", "99");
    expect(inRoot(() => useWizard(form, { steps, persistKey: "signup", storage })).index()).toBe(2);
    store.set("signup:step", "junk");
    expect(inRoot(() => useWizard(form, { steps, persistKey: "signup", storage })).index()).toBe(0);

    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    const report = vi.fn();
    const quiet = inRoot(() =>
      useWizard(form, { steps, persistKey: "x", storage: broken, onStorageError: report }),
    );
    await quiet.next();
    expect(quiet.index()).toBe(1);
    expect(report).toHaveBeenCalledTimes(2);
    const off = inRoot(() => useWizard(form, { steps, persistKey: "x", storage: null }));
    expect(off.index()).toBe(0);
  });

  it("[FRM-216] without onStorageError a refused storage write is reported with console.warn, and the wizard still moves", async () => {
    const form = create();
    form.setValues({ email: "a@b", password: "abcd" });
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    const warned = vi.mocked(console.warn);
    warned.mockClear();
    const wizard = inRoot(() =>
      useWizard(form, { steps, persistKey: "unreported", storage: broken }),
    );
    await wizard.next();
    expect(wizard.index()).toBe(1);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned.mock.calls[0]?.[0]).toContain("[forms]");
    warned.mockClear();
  });

  it("[FRM-215] a wizard needs steps", () => {
    const form = create();
    expect(() => useWizard(form, { steps: [] })).toThrow(RangeError);
  });
});
