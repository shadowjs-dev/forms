/**
 * The full preset (`@shadow-js/forms/full`): one import, the four features in order, and each
 * feature working through the preset. Invariants [FRM-510]..[FRM-519].
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import { dates } from "../src/dates";
import { full, useForm } from "../src/full";
import { FormSubmitError } from "../src/server-errors";
import { submitErrors } from "../src/submit-errors";
import { useForm as useFormFromEngine } from "../src/use-form";
import { inRoot, settle } from "./support/forms";

afterEach(() => {
  vi.useRealTimers();
});

describe("the full preset", () => {
  it("[FRM-510] `full` lists the four features in order: arrays, asyncValidation, submitErrors, dates", () => {
    expect(full.map((feature) => feature.name)).toEqual([
      "arrays",
      "asyncValidation",
      "submitErrors",
      "dates",
    ]);
    expect(full[0]).toBe(fieldArrays);
    expect(full[1]).toBe(asyncValidation);
    expect(full[2]).toBe(submitErrors);
    expect(full[3]).toBe(dates);
  });

  it("[FRM-511] the preset exports the engine's own `useForm`, so one import is enough", () => {
    expect(useForm).toBe(useFormFromEngine);
  });

  it("[FRM-512] the list is frozen: a write to it is refused and it keeps four features", () => {
    expect(Object.isFrozen(full)).toBe(true);
    expect(Reflect.set(full, "4", fieldArrays)).toBe(false);
    expect(full.length).toBe(4);
  });

  it("[FRM-513] `features: full` gives the form a working `fields(path)`", () => {
    const form = inRoot(() =>
      useForm({
        id: "playlist",
        features: full,
        defaultValues: { tags: [{ label: "news" }] },
      }),
    );
    const tags = form.fields("tags");
    tags.append({ label: "sports" });
    expect(tags.length()).toBe(2);
    expect(form.getValues("tags")).toEqual([{ label: "news" }, { label: "sports" }]);
  });

  it("[FRM-514] an async validator with `debounceMs` waits for the quiet period, then answers the field", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const form = inRoot(() =>
      useForm({
        id: "code",
        features: full,
        defaultValues: { code: "" },
        validateOn: "change",
      }),
    );
    form.field("code", {
      validate: {
        validate: async (code) => {
          calls.push(code);
          return code === "taken" ? "Taken" : undefined;
        },
        debounceMs: 300,
      },
    });
    form.field("code").setValue("ta");
    await vi.advanceTimersByTimeAsync(200);
    form.field("code").setValue("taken");
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["taken"]);
    await settle();
    expect(form.field("code").error()).toBe("Taken");
  });

  it("[FRM-515] a FormSubmitError thrown by `onSubmit` lands on the field it names, and the form keeps the summary", async () => {
    const form = inRoot(() =>
      useForm({
        id: "signup",
        features: full,
        defaultValues: { email: "ada@example.com" },
        onSubmit: () => {
          throw new FormSubmitError("Could not save", {
            fieldErrors: { email: "Already used" },
          });
        },
      }),
    );
    await form.handleSubmit();
    expect(form.field("email").error()).toBe("Already used");
    expect(form.submitError()?.message).toBe("Could not save");
  });

  it("[FRM-516] `initialErrors` (what a no-JavaScript post produced) are shown from the start, on their fields", () => {
    const form = inRoot(() =>
      useForm({
        id: "login",
        features: full,
        defaultValues: { email: "ada@example.com" },
        initialErrors: { email: "Already registered" },
      }),
    );
    expect(form.field("email").error()).toBe("Already registered");
  });
});
