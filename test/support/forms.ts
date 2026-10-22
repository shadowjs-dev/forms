/**
 * Helpers shared by the suites: creating a form inside an owner that is disposed after the test,
 * and small DOM utilities. Everything is synchronous (`flushSync`), nothing sleeps.
 */
import { createRoot, flushSync } from "@shadow-js/core";
import { afterEach } from "vitest";
import { fieldArrays } from "../../src/arrays";
import { asyncValidation } from "../../src/async";
import { dates } from "../../src/dates";
import {
  type FieldArraysApi,
  type FormApi,
  type FormFeature,
  type UseFormOptions,
  useForm,
} from "../../src/index";
import { submitErrors } from "../../src/submit-errors";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  if (typeof document !== "undefined") document.body.innerHTML = "";
});

/** Every opt-in feature: the suites exercise the full engine unless a test passes `features`. */
export const allFeatures: readonly [
  FormFeature<"arrays">,
  FormFeature<"asyncValidation">,
  FormFeature<"submitErrors">,
  FormFeature<"dates">,
] = [fieldArrays, asyncValidation, submitErrors, dates];

/**
 * Creates a form inside an owner that is disposed after the test. All features are on unless the
 * options name their own `features` (the minimal path is tested with `features: []`).
 */
export function makeForm<TInput extends object, TOutput = TInput>(
  options: UseFormOptions<TInput, TOutput, readonly FormFeature[]> = {},
): FormApi<TInput, TOutput> & FieldArraysApi<TInput> {
  const { features = allFeatures, ...rest } = options;
  return createRoot((dispose) => {
    disposers.push(dispose);
    return useForm<TInput, TOutput, readonly FormFeature[]>({
      id: "t",
      features,
      ...rest,
    }) as FormApi<TInput, TOutput> & FieldArraysApi<TInput>;
  });
}

/** Runs `fn` in an owner disposed after the test (effects, memos). */
export function inRoot<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

/** Types text into an input the way a browser does: set the value, then dispatch `input`. */
export function type(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

/** Moves focus away from an element (dispatches blur and focusout). */
export function blur(element: HTMLElement): void {
  element.dispatchEvent(new FocusEvent("blur"));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  flushSync();
}

/** Resolves after pending promise callbacks ran (no timers involved). */
export async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
