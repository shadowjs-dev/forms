/**
 * Multi-step forms: each step checks only its own fields before the user can move on, and the
 * current step can be remembered in browser storage.
 * @packageDocumentation
 */
import { type Accessor, useSignal } from "@shadow-js/core";
import type { FormApi, Path } from "./types";

/**
 * One step: an id and the field paths (or prefixes such as `"address"`) it owns.
 *
 * @example
 * ```ts
 * import type { WizardStep } from "@shadow-js/forms";
 *
 * interface Signup {
 *   email: string;
 *   address: { street: string; city: string };
 * }
 *
 * const shipping: WizardStep<Signup> = { id: "shipping", fields: ["address"] };
 * console.log(shipping.fields); // ["address"]: checks street and city
 * ```
 * @since 1.0.0
 */
export interface WizardStep<TInput extends object> {
  /** A name for the step, for your UI (titles, progress, URLs). The wizard does not read it. */
  readonly id: string;
  /** Paths the step validates before the wizard moves on. Containers cover everything below them. */
  readonly fields: readonly Path<TInput>[];
}

/**
 * Options of {@link useWizard}.
 *
 * @example
 * ```ts
 * import { useForm, useWizard, type WizardOptions } from "@shadow-js/forms";
 *
 * interface Signup {
 *   email: string;
 *   name: string;
 * }
 *
 * const form = useForm<Signup>({ id: "signup", defaultValues: { email: "", name: "" } });
 * const options: WizardOptions<Signup> = {
 *   steps: [
 *     { id: "account", fields: ["email"] },
 *     { id: "profile", fields: ["name"] },
 *   ],
 *   initialStep: 1,
 *   persistKey: "signup",
 *   storage: null,
 * };
 * const wizard = useWizard(form, options);
 * console.log(wizard.current().id); // "profile"
 * ```
 * @since 1.0.0
 */
export interface WizardOptions<TInput extends object> {
  /** The steps, in order. At least one: an empty list throws a `RangeError`. */
  readonly steps: readonly WizardStep<TInput>[];
  /** Step to start on, truncated and clamped to the steps. A remembered step wins over it. Default 0. */
  readonly initialStep?: number | undefined;
  /**
   * Remember the step under `${persistKey}:step` in storage. A stored value that is not a number
   * of at most three digits is ignored; a stored number is clamped to the steps. Omit to keep the
   * step in memory only.
   */
  readonly persistKey?: string | undefined;
  /** Where to remember it, when `persistKey` is set. Default `sessionStorage` (none on the server); `null` disables persistence. */
  readonly storage?: Storage | null | undefined;
  /**
   * Receives storage failures (private mode, quota). Persistence is best effort. Default:
   * `console.warn` once per failure.
   */
  readonly onStorageError?: ((error: unknown) => void) | undefined;
}

/**
 * What {@link useWizard} returns. The accessors are reactive.
 *
 * @example
 * ```tsx
 * import { useForm, useWizard, type WizardApi } from "@shadow-js/forms";
 *
 * function Navigation(props: { wizard: WizardApi<{ email: string; name: string }> }) {
 *   const { wizard } = props;
 *   return (
 *     <nav>
 *       <button type="button" disabled={wizard.isFirst()} onClick={() => wizard.back()}>
 *         Back
 *       </button>
 *       <span>
 *         Step {wizard.index() + 1} of {wizard.steps.length}
 *       </span>
 *       <button type="button" onClick={() => void wizard.next()}>
 *         {wizard.isLast() ? "Finish" : "Next"}
 *       </button>
 *     </nav>
 *   );
 * }
 *
 * export function Signup() {
 *   const form = useForm({ defaultValues: { email: "", name: "" } });
 *   const wizard = useWizard(form, {
 *     steps: [
 *       { id: "account", fields: ["email"] },
 *       { id: "profile", fields: ["name"] },
 *     ],
 *   });
 *   return <Navigation wizard={wizard} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface WizardApi<TInput extends object> {
  /** The steps the wizard was created with. */
  readonly steps: readonly WizardStep<TInput>[];
  /** Index of the current step. */
  readonly index: Accessor<number>;
  /** The current step. */
  readonly current: Accessor<WizardStep<TInput>>;
  /** True on the first step. */
  readonly isFirst: Accessor<boolean>;
  /** True on the last step. */
  readonly isLast: Accessor<boolean>;
  /**
   * Validates the current step's fields and moves on when they are clean; when they are not, it
   * stays and focuses the first invalid control. Resolves to whether the step is clean. On the last
   * step it validates without moving.
   */
  next(): Promise<boolean>;
  /** Moves back one step. Never validates. Does nothing on the first step. */
  back(): void;
  /**
   * Moves to a step (truncated and clamped to the steps). An earlier step (or the current one) is
   * reached at once. A later one is reached only when every step before it is clean: the wizard
   * stops on the first step that is not, focuses its first invalid control and resolves to `false`.
   */
  goTo(index: number): Promise<boolean>;
}

/**
 * The default receiver of a storage failure: persistence is best effort, so the wizard keeps
 * working, and the developer sees why the step is not remembered. Pass `onStorageError` to route it
 * elsewhere.
 */
function reportStorageFailure(error: unknown): void {
  console.warn(
    "[forms] useWizard: the step could not be saved or restored; persistence is off",
    error,
  );
}

function storageOf(
  option: Storage | null | undefined,
  report: (error: unknown) => void,
): Storage | null {
  if (option === null) return null;
  if (option !== undefined) return option;
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch (error) {
    report(error);
    return null;
  }
}

/**
 * Creates a wizard over `form`: a multi-step form where each step checks only its own fields
 * (with `form.trigger`) before the user can move on. All steps share one form, so the last step
 * submits everything.
 *
 * @param form The form to step through.
 * @param options Steps and persistence (see {@link WizardOptions}).
 * @returns Step state and navigation (see {@link WizardApi}).
 * @throws RangeError when `options.steps` is empty.
 * @example
 * ```tsx
 * import { Form, useForm, useWizard } from "@shadow-js/forms";
 *
 * export function Signup() {
 *   const form = useForm({
 *     defaultValues: { email: "", password: "", name: "" },
 *     validators: {
 *       email: (value: string) => (value.includes("@") ? undefined : "Enter an email"),
 *       name: (value: string) => (value === "" ? "Enter your name" : undefined),
 *     },
 *   });
 *   const wizard = useWizard(form, {
 *     steps: [
 *       { id: "account", fields: ["email", "password"] },
 *       { id: "profile", fields: ["name"] },
 *     ],
 *     persistKey: "signup",
 *   });
 *   return (
 *     <Form form={form}>
 *       {() =>
 *         wizard.current().id === "account" ? (
 *           <input type="email" {...form.field("email").props()} />
 *         ) : (
 *           <input {...form.field("name").props()} />
 *         )
 *       }
 *       {() =>
 *         wizard.isLast() ? (
 *           <button type="submit">Create account</button>
 *         ) : (
 *           <button type="button" onClick={() => void wizard.next()}>
 *             Next
 *           </button>
 *         )
 *       }
 *     </Form>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function useWizard<TInput extends object, TOutput = TInput>(
  form: FormApi<TInput, TOutput>,
  options: WizardOptions<TInput>,
): WizardApi<TInput> {
  const steps = options.steps;
  if (steps.length === 0)
    throw new RangeError(__DEV__ ? "[forms] a wizard needs at least one step" : "FORMS_WIZARD_2");
  const last = steps.length - 1;
  // NaN would make the index NaN, and no step: it counts as the first one.
  const clamp = (n: number): number =>
    Math.min(Math.max(0, Number.isNaN(n) ? 0 : Math.trunc(n)), last);
  // Every index used here is clamped into the steps, so the error is a guard for the type only.
  const stepAt = (i: number): WizardStep<TInput> => {
    const step = steps[i];
    if (step === undefined)
      throw new RangeError(__DEV__ ? `[forms] a wizard has no step ${i}` : "FORMS_WIZARD_1");
    return step;
  };
  const report = options.onStorageError ?? reportStorageFailure;
  const storage = options.persistKey === undefined ? null : storageOf(options.storage, report);
  const storageKey = `${options.persistKey}:step`;
  let stored: number | undefined;
  if (storage !== null) {
    try {
      const text = storage.getItem(storageKey);
      if (text !== null && /^\d{1,3}$/.test(text)) stored = Number(text);
    } catch (error) {
      report(error);
    }
  }
  const [index, setIndex] = useSignal(clamp(stored ?? options.initialStep ?? 0));
  const move = (n: number): void => {
    const next = clamp(n);
    setIndex(next);
    if (storage === null) return;
    try {
      storage.setItem(storageKey, String(next));
    } catch (error) {
      report(error);
    }
  };
  const current = (): WizardStep<TInput> => stepAt(index());
  const check = async (step: WizardStep<TInput>): Promise<boolean> => {
    const clean = await form.trigger(step.fields);
    if (!clean) form.focusFirstError();
    return clean;
  };
  return {
    steps,
    index,
    current,
    isFirst: () => index() === 0,
    isLast: () => index() === last,
    async next() {
      const at = index();
      if (!(await check(stepAt(at)))) return false;
      if (at < last) move(at + 1);
      return true;
    },
    back() {
      if (index() > 0) move(index() - 1);
    },
    async goTo(target) {
      const wanted = clamp(target);
      const from = index();
      if (wanted <= from) {
        move(wanted);
        return true;
      }
      for (let step = from; step < wanted; step += 1) {
        if (!(await check(stepAt(step)))) {
          move(step);
          return false;
        }
      }
      move(wanted);
      return true;
    },
  };
}
