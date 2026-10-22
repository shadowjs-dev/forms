/**
 * `useForm`: values in a deep fine-grained store, per-field state in records keyed by stable
 * keys, validation with Standard Schema, and the handles built on them.
 * @packageDocumentation
 */
import {
  type Accessor,
  getOwner,
  onCleanup,
  reconcile,
  type Store,
  untrack,
  unwrap,
  useEffect,
  useId,
  useStore,
} from "@shadow-js/core";
import { deepEqual, isContainer, plainClone } from "./data";
import { remember } from "./internal/cache";
import { Cell } from "./internal/cell";
import type { FeatureHost } from "./internal/feature-host";
import { createField, type FieldHost, type FieldImpl } from "./internal/field";
import { missingFeature, textSegments, toIssues } from "./internal/issues";
import { staticLoc } from "./internal/loc";
import {
  clearPushed,
  peekAt,
  pushIssues,
  resetAll,
  resetPath,
  unregisterPath,
  writeMany,
  writesOf,
} from "./internal/mutate";
import { readOnly } from "./internal/shape";
import {
  type Core,
  defaultAtParts,
  indexPathOf,
  isUnder,
  keyOfSegments,
  type Loc,
  type Resolved,
  recOfSegments,
  rootRec,
  setShown,
  slotsOf,
  walk,
} from "./internal/state";
import { focusFirstProblem, runSubmit, shownIssues } from "./internal/submit";
import { hasIssues, validate } from "./internal/validate";
import { formatPath, getIn, parsePath, parsePattern, type Segment } from "./path";
import type {
  AsyncDefaultValues,
  DefaultValues,
  FeatureApi,
  FieldApi,
  FieldOptions,
  FieldStateView,
  FieldValidator,
  FormApi,
  FormElementProps,
  FormFeature,
  FormMode,
  FormOptions,
  FormStateView,
  IssueInput,
  Path,
  PathValue,
  ResetOptions,
  ReValidateMode,
  ReValidateOn,
  SetValueOptions,
  SubmitErrorState,
  UnregisterOptions,
  UseFormOptions,
  ValidateOn,
  ValidatorSpec,
} from "./types";

export { MAX_HANDLES } from "./internal/cache";

/** The `validateOn` of each mode (every mode re-validates on change). */
const MODES: Record<FormMode, ValidateOn[]> = {
  onSubmit: ["submit"],
  onBlur: ["blur"],
  onChange: ["change"],
  onTouched: ["touched"],
  all: ["blur", "change"],
};

/**
 * How many forms were created outside any component. Such forms (module-level, shared) have no
 * position in an owner tree to derive an id from, so they are numbered in creation order:
 * `form`, `form-2`, `form-3`... The order is the module evaluation order, which is the same on the
 * server and in the browser. Pass `id` to name a shared form for good.
 */
let ownerlessForms = 0;

function ownerlessId(): string {
  ownerlessForms += 1;
  return ownerlessForms === 1 ? "form" : `form-${ownerlessForms}`;
}

/** React Hook Form's `reValidateMode` names, as `reValidateOn` values. */
const REVALIDATE: Record<ReValidateMode, ReValidateOn> = {
  onChange: "change",
  onBlur: "blur",
  onSubmit: "submit",
};

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** The defaults given as plain values (not a function and not a promise); `undefined` otherwise. */
function syncDefaults<T>(
  given: DefaultValues<T> | AsyncDefaultValues<T> | undefined,
): DefaultValues<T> | undefined {
  return typeof given === "function" || isThenable(given) ? undefined : given;
}

/** A list given as one item or several (a type guard: `Array.isArray` would narrow to `any[]`). */
function isList<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

const asList = <T>(value: T | readonly T[]): readonly T[] => (isList(value) ? value : [value]);

/**
 * An object whose members are getters: each read of a member calls its reader, so a read inside an
 * effect subscribes to what the reader reads (the state accessors of the form and of a field).
 */
function lazyView<T extends object>(readers: { [K in keyof T]: () => T[K] }): T {
  // Justified cast: the descriptors give every key of `readers` its getter, which TypeScript cannot see.
  const view = {} as T;
  for (const key of Object.keys(readers) as Array<keyof T>) {
    Object.defineProperty(view, key, { get: readers[key], enumerable: true, configurable: true });
  }
  return view;
}

/** A validator given as a plain function: the form's `validators` accept any value type. */
function isValidatorFunction(value: unknown): value is FieldValidator<unknown, object> {
  return typeof value === "function";
}

/**
 * The engine's spec of a `validators` entry that is an object. The map's type promises the
 * `validate` function. A value that breaks that promise fails when the form runs it, as before.
 */
function specOf(value: unknown): ValidatorSpec<unknown, object> {
  if (isValidatorFunction(value)) return { validate: value };
  // Justified cast: the map's type checks the entry's shape where it is written, not here.
  const spec = value as { validate: FieldValidator<unknown, object>; debounceMs?: number };
  return { validate: spec.validate, debounceMs: spec.debounceMs };
}

function resolve<TInput extends object, TOutput>(options: FormOptions<TInput, TOutput>): Resolved {
  const validateOn = options.validateOn ?? (options.mode && MODES[options.mode]) ?? "touched";
  const reValidateOn: ReValidateOn | readonly ReValidateOn[] =
    options.reValidateOn ??
    (options.reValidateMode === undefined ? undefined : REVALIDATE[options.reValidateMode]) ??
    "change";
  if (Reflect.has(options, "schema")) {
    throw new TypeError(
      "[forms] `schema` is now `resolver: standardSchema(schema)` (@shadow-js/forms/standard-schema)",
    );
  }
  const patterns = Object.entries(options.validators ?? {}).map(([text, value]) => ({
    pattern: parsePattern(text),
    spec: specOf(value),
  }));
  return {
    validateOn: new Set(asList(validateOn)),
    reValidateOn: new Set(asList(reValidateOn)),
    debounceMs: options.debounceMs ?? 0,
    emptyValue: options.emptyValue ?? "string",
    excludeDisabled: options.excludeDisabled ?? true,
    shouldFocusError: options.shouldFocusError ?? true,
    criteriaMode: options.criteriaMode ?? "all",
    shouldUnregister: options.shouldUnregister ?? false,
    resetOnSuccess: options.resetOnSuccess ?? false,
    resolver: options.resolver,
    validate: options.validate,
    patterns,
  };
}

/**
 * Creates a form. Call it in a component (or at module scope for a shared form: then pass `id`;
 * without one, forms made outside a component are numbered in creation order, `form`, `form-2`...,
 * so two shared forms never share control ids).
 *
 * The component runs once: nothing here re-renders. Reading `form.field("email").value()` inside
 * JSX or an effect subscribes to that one value, so a keystroke updates only the readers of the
 * field that changed.
 *
 * The values type is inferred from `defaultValues` (or given as a type argument), and the output
 * type from the `resolver`. Opt-in features (`fieldArrays`, `asyncValidation`, `submitErrors`) are
 * passed in `features`; `form.fields` exists only with `fieldArrays`. Explicit type arguments
 * select the overload without features, so with features leave the types inferred.
 *
 * @param options Default values, resolver, validation rules, features and the submit handler (see
 *   {@link FormOptions} and {@link UseFormOptions}). Default: `{}`.
 * @returns The form: handles for fields (and arrays with `fieldArrays`), state accessors and
 *   actions (see {@link FormApi}).
 * @throws TypeError when `options` has a `schema` (use `resolver: standardSchema(schema)`), when
 *   `debounceMs` (of the form or of an entry of `validators`) is above 0 without the
 *   `asyncValidation` feature, or when `initialErrors` is given without the `submitErrors` feature.
 *   Each message names what to add.
 * @throws FormPathError when a key of `validators` is not a valid path pattern.
 * @example
 * ```tsx
 * import { type StandardSchemaV1, useForm } from "@shadow-js/forms";
 * import { standardSchema } from "@shadow-js/forms/standard-schema";
 *
 * // Any Standard Schema works here (Zod, Valibot, ArkType...); this one is written by hand.
 * const signupSchema: StandardSchemaV1<{ email: string }> = {
 *   "~standard": {
 *     version: 1,
 *     vendor: "example",
 *     validate: (value) => {
 *       const email = String((value as { email?: unknown }).email ?? "");
 *       return email.includes("@")
 *         ? { value: { email } }
 *         : { issues: [{ message: "Enter an email", path: ["email"] }] };
 *     },
 *   },
 * };
 *
 * export function Signup() {
 *   const form = useForm({
 *     resolver: standardSchema(signupSchema),
 *     defaultValues: { email: "" },
 *     onSubmit: async (data) => {
 *       await fetch("/api/signup", { method: "POST", body: JSON.stringify(data) });
 *     },
 *   });
 *   const email = form.field("email");
 *   return (
 *     <form {...form.props()}>
 *       <input type="email" {...email.props()} />
 *       <p id={email.errorId}>{email.error()}</p>
 *       <button type="submit">Sign up</button>
 *     </form>
 *   );
 * }
 * ```
 * @see {@link FormApi}
 * @since 1.0.0
 */
export function useForm<TInput extends object, TOutput = TInput>(
  options?: FormOptions<TInput, TOutput> & { readonly features?: undefined },
): FormApi<TInput, TOutput>;
export function useForm<
  TInput extends object,
  TOutput = TInput,
  const F extends readonly FormFeature[] = readonly FormFeature[],
>(
  options: UseFormOptions<TInput, TOutput, F> & { readonly features: F },
): FormApi<TInput, TOutput> & FeatureApi<TInput, F>;
export function useForm<
  TInput extends object,
  TOutput = TInput,
  const F extends readonly FormFeature[] = readonly FormFeature[],
>(options: UseFormOptions<TInput, TOutput, F> = {}): FormApi<TInput, TOutput> {
  const owner = getOwner();
  const id = options.id ?? (owner === null ? ownerlessId() : useId());
  const given = options.defaultValues;
  // Asynchronous defaults: a function returning a promise, or a promise. The form starts empty.
  const loader: (() => Promise<DefaultValues<TInput>>) | undefined =
    typeof given === "function"
      ? () => new Promise<DefaultValues<TInput>>((resolve) => resolve(given()))
      : isThenable(given)
        ? () => new Promise<DefaultValues<TInput>>((resolve) => resolve(given))
        : undefined;
  // A `values` accessor provides the starting values when it has some; otherwise the defaults do.
  const valuesSource = options.values;
  const initialValues = valuesSource === undefined ? undefined : untrack(valuesSource);
  const seed: object = loader !== undefined ? {} : (initialValues ?? syncDefaults(given) ?? {});
  const defaults = plainClone(seed);
  const [values, setStore] = useStore(plainClone(defaults));
  const disabledOption = options.disabled;
  const core: Core = {
    id,
    opts: resolve(options),
    values,
    write: (fn) => setStore(fn),
    replace: (next) => setStore(reconcile(next)),
    raw: () => unwrap(values),
    defaults,
    recs: new Map(),
    rows: new Map(),
    rowRecs: new Map(),
    rowArrays: new Map(),
    rowCounter: 0,
    invalid: new Set(),
    shownKeys: new Set(),
    schemaKeys: new Set(),
    pushedKeys: new Set(),
    disabledKeys: new Set(),
    boundKeys: new Set(),
    boundElements: new WeakSet(),
    version: new Cell(0),
    shape: new Cell(0),
    meta: new Cell(0),
    invalidCount: new Cell(0),
    touchedCount: new Cell(0),
    validatingCount: new Cell(0),
    submitCount: new Cell(0),
    submitting: new Cell(false),
    submitted: new Cell(false),
    successful: new Cell(false),
    submitError: new Cell<SubmitErrorState | undefined>(undefined),
    composing: 0,
    deferred: undefined,
    handleValidators: new Set(),
    schemaRun: { token: 0, controller: undefined, timer: undefined },
    output: undefined,
    excluded: [],
    excludedCount: new Cell(0),
    unknown: new Cell(false),
    submitToken: 0,
    submitController: undefined,
    disposed: false,
    schemaAsync: false,
    schemaPending: new Cell(false),
    loading: new Cell(loader !== undefined),
    loadError: new Cell<unknown>(undefined),
    formDisabled:
      typeof disabledOption === "function" ? disabledOption : () => disabledOption === true,
    arrays: undefined,
    dates: undefined,
    async: undefined,
    submitErrors: undefined,
  };

  const fields = new Map<string, FieldImpl>();
  const host: FieldHost = { core, child: (loc: Loc) => createField(host, loc) };

  const segmentsOf = (path: string): Segment[] => [...parsePath(path)];
  const pathOfKey = (key: string): string | undefined => {
    const rec = core.recs.get(key);
    if (rec === undefined) return undefined;
    const segments = indexPathOf(core, rec);
    return segments === undefined ? undefined : segments.join(".");
  };

  const fieldAt = (path: string, fieldOptions?: FieldOptions<unknown, TInput>): FieldImpl => {
    const segments = segmentsOf(path);
    const text = formatPath(segments);
    const handle = remember(fields, text, () => createField(host, staticLoc(core, segments)));
    if (fieldOptions?.validate !== undefined) {
      const spec = specOf(fieldOptions.validate);
      if ((spec.debounceMs ?? 0) > 0 && core.async === undefined) throw debounceError();
      const exists = [...core.handleValidators].some(
        (entry) => entry.spec.validate === spec.validate && entry.loc === handle.loc,
      );
      if (!exists) {
        const remove = handle.addValidator(spec);
        if (getOwner() !== null) onCleanup(remove);
      }
    }
    if (fieldOptions?.disabled === true) handle.setDisabled(true);
    return handle;
  };

  /** The paths a caller named, as prefixes; `undefined` for "everything". */
  const prefixesOf = (paths: string | readonly string[] | undefined): Segment[][] | undefined =>
    paths === undefined ? undefined : asList(paths).map((path) => textSegments(path));

  const formState: FormStateView = lazyView<FormStateView>({
    isDirty: () => form.isDirty(),
    isValid: () => form.isValid(),
    isTouched: () => form.isTouched(),
    isSubmitting: () => form.isSubmitting(),
    isValidating: () => form.isValidating(),
    isSubmitted: () => form.isSubmitted(),
    isSubmitSuccessful: () => form.isSubmitSuccessful(),
    isDisabled: () => form.isDisabled(),
    isLoading: () => core.loading.get(),
    submitCount: () => form.submitCount(),
    submitError: () => form.submitError(),
    errors: () => form.errors(),
    touchedFields: () => form.touchedFields(),
    dirtyFields: () => form.dirtyFields(),
  });

  const dispose = (): void => {
    if (core.disposed) return;
    core.disposed = true;
    core.submitToken += 1;
    core.submitController?.abort();
    const run = core.schemaRun;
    run.controller?.abort();
    run.token += 1;
    core.async?.stop();
    for (const rec of core.recs.values()) {
      core.async?.cancel(rec);
      rec.bindings = undefined;
    }
    core.boundKeys.clear();
    core.handleValidators.clear();
  };
  if (owner !== null) onCleanup(dispose);

  const dirtyCache: { version: number; result: boolean } = { version: -1, result: false };
  const focusFirst = (): boolean =>
    typeof document === "undefined" ? false : focusFirstProblem(core);

  // `FormApi.field` is generic in the path; the body is the untyped `fieldAt`, so the overload
  // carries the type (the same way the row and field handles type their `field`).
  function field<P extends Path<TInput>>(
    path: P,
    fieldOptions?: FieldOptions<unknown, TInput>,
  ): FieldApi<PathValue<TInput, P>>;
  function field(path: string, fieldOptions?: FieldOptions<unknown, TInput>): unknown {
    return fieldAt(path, fieldOptions);
  }

  // `getValues` and `watch` are overloaded by whether a path is given (see `FormApi`); the bodies
  // work on untyped values, so the overloads carry the types.
  function getValues(): TInput;
  function getValues<P extends Path<TInput>>(path: P): PathValue<TInput, P>;
  function getValues(path?: string): unknown {
    const raw = core.raw();
    return plainClone(path === undefined ? raw : peekAt(core, segmentsOf(path)));
  }
  function watch(): Accessor<TInput>;
  function watch<P extends Path<TInput>>(path: P): Accessor<PathValue<TInput, P>>;
  function watch(path?: string): unknown {
    if (path === undefined) {
      return () => {
        core.version.get();
        return plainClone(core.raw());
      };
    }
    const segments = segmentsOf(path);
    return () => getIn(core.values, segments);
  }

  const form: FormApi<TInput, TOutput> = {
    id,
    // Justified cast: the store holds the values the caller typed as TInput; the seed came from them.
    values: values as Store<TInput>,
    field,
    fieldAt,

    errors() {
      core.meta.get();
      const out: Record<string, string> = {};
      for (const key of core.shownKeys) {
        if (key === "") continue;
        const rec = core.recs.get(key);
        const path = pathOfKey(key);
        const first = rec?.slots?.shown.value[0];
        if (path !== undefined && first !== undefined) out[path] = first.message;
      }
      return out;
    },
    issues() {
      core.meta.get();
      return shownIssues(core, pathOfKey);
    },
    formErrors() {
      return slotsOf(rootRec(core)).shown.get();
    },
    touchedFields() {
      core.meta.get();
      const out: string[] = [];
      for (const rec of core.recs.values()) {
        if (rec.slots?.touched.value !== true || rec.key === "") continue;
        const path = pathOfKey(rec.key);
        if (path !== undefined) out.push(path);
      }
      return out;
    },
    dirtyFields() {
      core.version.get();
      core.meta.get();
      // A list equal to its defaults names no path, whatever the order its rows went through: this keeps
      // dirtyFields and isDirty in agreement (dirtyFields is empty exactly when isDirty is false).
      if (!form.isDirty()) return [];
      return dirtyPaths(core);
    },

    isValid: () =>
      core.invalidCount.get() === 0 && core.excludedCount.get() === 0 && !core.unknown.get(),
    isDirty() {
      const version = core.version.get();
      if (dirtyCache.version !== version) {
        dirtyCache.version = version;
        dirtyCache.result = !deepEqual(core.raw(), core.defaults);
      }
      return dirtyCache.result;
    },
    isTouched: () => core.touchedCount.get() > 0,
    isSubmitting: () => core.submitting.get(),
    isValidating: () => core.validatingCount.get() > 0 || core.schemaPending.get(),
    isSubmitted: () => core.submitted.get(),
    isSubmitSuccessful: () => core.successful.get(),
    isDisabled: () => core.formDisabled(),
    isLoading: () => core.loading.get(),
    loadError: () => core.loadError.get(),
    formState,
    submitCount: () => core.submitCount.get(),
    submitError: () => core.submitError.get(),

    setValue(path: string, value: unknown, setOptions?: SetValueOptions) {
      fieldAt(path).setValue(value, setOptions);
    },
    setValues(partial: DefaultValues<TInput>, setOptions?: SetValueOptions) {
      writeMany(core, writesOf(core, partial), {
        validate: setOptions?.validate,
        touch: setOptions?.touch,
      });
      for (const key of core.boundKeys) {
        for (const binding of core.recs.get(key)?.bindings?.values() ?? []) binding.sync();
      }
    },
    getValues,
    watch,

    async trigger(paths: string | readonly string[] | undefined) {
      const prefixes = prefixesOf(paths);
      await validate(core, { trigger: "manual", prefixes });
      return !hasIssues(core, prefixes);
    },
    setError(path: string, error: IssueInput | readonly IssueInput[]) {
      const segments = textSegments(path);
      const rec = recOfSegments(core, segments);
      pushIssues(core, rec, "manual", toIssues(error, "manual"));
    },
    clearErrors(paths: string | readonly string[] | undefined) {
      const prefixes = prefixesOf(paths);
      const keys =
        prefixes === undefined
          ? [""]
          : untrack(() => prefixes.map((p) => (p.length === 0 ? "" : keyOfSegments(core, p))));
      for (const prefix of keys) {
        clearPushed(core, prefix, ["server", "manual"]);
        for (const rec of core.recs.values()) {
          if (isUnder(rec.key, prefix)) setShown(core, rec, []);
        }
      }
    },
    reset(next: DefaultValues<TInput> | undefined, resetOptions?: ResetOptions) {
      resetAll(core, next, resetOptions);
    },
    getFieldState(path: string): FieldStateView {
      const field = fieldAt(path);
      return lazyView<FieldStateView>({
        invalid: () => field.invalid(),
        isTouched: () => field.touched(),
        isDirty: () => field.dirty(),
        isValidating: () => field.validating(),
        error: () => field.error(),
        errors: () => field.errors(),
      });
    },
    setFocus(path: string, focusOptions?: { readonly shouldSelect?: boolean | undefined }) {
      const field = fieldAt(path);
      field.focus();
      if (focusOptions?.shouldSelect !== true || typeof document === "undefined") return;
      for (const element of field.elements()) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.select();
        }
      }
    },
    unregister(path: string, unregisterOptions?: UnregisterOptions) {
      unregisterPath(core, segmentsOf(path), unregisterOptions);
    },
    resetField(path: string) {
      resetPath(core, segmentsOf(path));
    },
    focus: (path: string) => fieldAt(path).focus(),
    focusFirstError: focusFirst,

    handleSubmit: (event?: Event) =>
      runSubmit(
        core,
        form,
        event,
        options.onSubmit,
        (issues) => options.onInvalid?.(issues, { event }),
        pathOfKey,
      ),
    handleSubmitWith(
      onValid: Parameters<FormApi<TInput, TOutput>["handleSubmitWith"]>[0],
      onInvalid?: Parameters<FormApi<TInput, TOutput>["handleSubmitWith"]>[1],
    ) {
      return (event?: Event) => runSubmit(core, form, event, onValid, onInvalid, pathOfKey);
    },
    props(): FormElementProps {
      // Typed by the literal; the descriptors then make the members read-only, and `aria-busy` a
      // getter, as they always were.
      const element: FormElementProps = {
        id,
        noValidate: true,
        "aria-busy": undefined,
        onSubmit: (event: Event) => void form.handleSubmit(event),
      };
      return Object.defineProperties(element, {
        id: readOnly(id),
        noValidate: readOnly(true),
        "aria-busy": {
          get: () => (core.submitting.get() ? true : undefined),
          enumerable: true,
          configurable: false,
        },
        onSubmit: readOnly(element.onSubmit),
      });
    },
    dispose,
  };

  // The opt-in features attach their members (`fields`, the async plug...) before anything runs.
  const featureHost: FeatureHost = {
    core,
    form,
    field: host,
    options,
  };
  for (const feature of options.features ?? []) feature.install(featureHost);
  const debounced =
    (options.debounceMs ?? 0) > 0 ||
    core.opts.patterns.some((entry) => (entry.spec.debounceMs ?? 0) > 0);
  if (debounced && core.async === undefined) throw debounceError();

  // Asynchronous defaults become the baseline once they arrive; a failure is kept for `loadError()`.
  if (loader !== undefined) {
    void loader().then(
      (loaded) => {
        if (core.disposed) return;
        core.loadError.set(undefined);
        core.loading.set(false);
        resetAll(core, loaded);
      },
      (error: unknown) => {
        if (core.disposed) return;
        core.loadError.set(error);
        core.loading.set(false);
      },
    );
  }
  // A `values` accessor resets the form each time it returns another object.
  if (valuesSource !== undefined && owner !== null) {
    let applied: unknown = initialValues;
    useEffect(() => {
      const next = valuesSource();
      if (next === applied) return;
      applied = next;
      if (next !== undefined) untrack(() => resetAll(core, next));
    });
  }

  // Problems the server sent with the page (a no-JavaScript post) are shown by the submitErrors feature.
  if (options.initialErrors !== undefined && core.submitErrors === undefined) {
    throw new TypeError(missingFeature("initialErrors", "submitErrors", "submit-errors"));
  }
  validate(core, { trigger: "init", prefixes: undefined });
  return form;
}

/** The error of a `debounceMs` without the asyncValidation feature. */
function debounceError(): TypeError {
  return new TypeError(missingFeature("debounceMs", "asyncValidation", "async"));
}

/**
 * The paths that differ from the defaults, for `dirtyFields()`, in two groups: the leaves whose value
 * differs from their own default (document order), then the shapes that differ. A shape is an array
 * with another length or row order, an object that lost a key of its defaults, or an empty container
 * where the defaults had another value; it names a removed row or key, which has no leaf left.
 * Iterative: the depth is the user's.
 */
function dirtyPaths(core: Core): string[] {
  const leaves: string[] = [];
  const shapes: string[] = [];
  const stack: Array<{ segments: Segment[]; value: unknown }> = [
    { segments: [], value: core.raw() },
  ];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { segments, value } = item;
    const { key, baseline } = untrack(() => baselineOf(core, segments));
    if (!isContainer(value)) {
      if (segments.length > 0 && !deepEqual(value, baseline)) leaves.push(segments.join("."));
      continue;
    }
    if (Array.isArray(value)) {
      if (!Array.isArray(baseline) || baseline.length !== value.length || core.arrays?.moved(key)) {
        shapes.push(segments.join("."));
      }
      for (let index = 0; index < value.length; index += 1) {
        stack.push({ segments: [...segments, index], value: value[index] });
      }
      continue;
    }
    if (isContainer(baseline) && !Array.isArray(baseline)) {
      for (const name of Object.keys(baseline)) {
        if (!Object.hasOwn(value, name) && baseline[name] !== undefined) {
          shapes.push([...segments, name].join("."));
        }
      }
    } else if (Object.keys(value).length === 0 && segments.length > 0) {
      shapes.push(segments.join("."));
    }
    for (const name of Object.keys(value)) {
      stack.push({ segments: [...segments, name], value: value[name] });
    }
  }
  // Pushed in document order, so the stack visits the leaves last to first.
  return [...leaves.reverse(), ...shapes];
}

/** The stable key of an index path, and the default value that belongs to it (read untracked). */
function baselineOf(core: Core, segments: readonly Segment[]): { key: string; baseline: unknown } {
  const walked = walk(core, segments, { key: "", node: core.raw(), parts: [], rows: [], from: 0 });
  return { key: walked.key, baseline: defaultAtParts(core, walked.parts) };
}
