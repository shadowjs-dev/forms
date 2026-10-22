/**
 * The React Hook Form style hooks, built on the form's own accessors: `useWatch`, `useFormState`
 * and `useFieldArray`. Each returns accessors or live objects, so a read inside an effect or JSX
 * subscribes to exactly what it reads.
 * @packageDocumentation
 */
import type { Accessor } from "@shadow-js/core";
import { useFormContext } from "./components";
import { plainClone } from "./data";
import { fieldsOf } from "./internal/fields-of";
import { getIn, parsePath } from "./path";
import type {
  ArrayItem,
  ArrayPath,
  FormApi,
  FormStateView,
  Path,
  PathValue,
  RowApi,
} from "./types";

/**
 * Options of {@link useWatch}.
 *
 * @example
 * ```ts
 * import { useForm, useWatch, type UseWatchOptions } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "address", defaultValues: { city: "", zip: "" } });
 * const options: UseWatchOptions<{ city: string; zip: string }, string> = {
 *   form,
 *   name: "city",
 *   defaultValue: "",
 *   compute: (city) => String(city).toUpperCase(),
 * };
 * const city = useWatch(options);
 * form.setValue("city", "Oslo");
 * console.log(city()); // "OSLO"
 * ```
 * @since 1.0.0
 */
export interface UseWatchOptions<TInput extends object = object, TValue = unknown> {
  /** The form to watch. Default: the form of the nearest `<FormProvider>` or `<Form>`. */
  readonly form?: FormApi<TInput, unknown> | undefined;
  /**
   * A path, or several paths (the result is then an array in the same order). Without a name the
   * result is a plain copy of all values. A malformed path throws a `FormPathError` when the
   * accessor is read.
   */
  readonly name?: string | readonly string[] | undefined;
  /** Returned in place of a named path whose value is `undefined`. Not used without `name`. */
  readonly defaultValue?: unknown;
  /**
   * With `true`, only the value at `name` itself is read: changes below it do not rerun the
   * reader, and an object or array comes back as the form's read-only store view. Default
   * `false`: the value is copied deeply, so any change under `name` reruns the reader.
   */
  readonly exact?: boolean | undefined;
  /** Transforms the watched value (after `defaultValue`) before it is returned. */
  readonly compute?: ((value: unknown) => TValue) | undefined;
}

/**
 * Watches values of the form. The result is an accessor: call it in an effect or in JSX to
 * subscribe. It is the form's `watch`, with a name, a default, a transform and the `exact` rule of
 * React Hook Form's `useWatch`.
 *
 * @param options What to watch and how (see {@link UseWatchOptions}). `form` may be omitted
 *   inside a `<FormProvider>` or `<Form>`. Default: `{}`.
 * @returns An accessor of the (computed) value.
 * @throws Error when no form is given and there is no provider above.
 * @example
 * ```tsx
 * import { useForm, useWatch } from "@shadow-js/forms";
 *
 * export function ShippingNote() {
 *   const form = useForm({ defaultValues: { address: { city: "" } } });
 *   const city = useWatch({ form, name: "address.city" });
 *   return (
 *     <>
 *       <input {...form.field("address.city").props()} />
 *       <output>{city() === "" ? "No city yet" : `Shipping to ${city()}`}</output>
 *     </>
 *   );
 * }
 * ```
 * @see {@link FormApi.watch}
 * @since 1.0.0
 */
export function useWatch<TInput extends object, P extends Path<TInput>>(options: {
  readonly form: FormApi<TInput, unknown>;
  readonly name: P;
  readonly defaultValue?: unknown;
  readonly exact?: boolean | undefined;
}): Accessor<PathValue<TInput, P>>;
export function useWatch<TValue = unknown, TInput extends object = object>(
  options?: UseWatchOptions<TInput, TValue>,
): Accessor<TValue>;
export function useWatch<TInput extends object, TValue>(
  options: UseWatchOptions<TInput, TValue> = {},
): Accessor<unknown> {
  const form: FormApi<TInput, unknown> = options.form ?? useFormContext<TInput>();
  const names = options.name;
  const exact = options.exact === true;
  const fallback = options.defaultValue;
  const compute = options.compute;

  const readOne = (path: string): unknown => {
    const value = getIn(form.values, parsePath(path));
    const current = exact ? value : plainClone(value);
    return current === undefined ? fallback : current;
  };

  return () => {
    const value: unknown =
      names === undefined
        ? form.watch()()
        : typeof names === "string"
          ? readOne(names)
          : names.map(readOne);
    return compute === undefined ? value : compute(value);
  };
}

/**
 * Options of {@link useFormState}.
 *
 * @example
 * ```ts
 * import { useForm, useFormState, type UseFormStateOptions } from "@shadow-js/forms";
 *
 * const form = useForm({ id: "settings", defaultValues: { theme: "light" } });
 * const options: UseFormStateOptions<{ theme: string }, "isDirty"> = { form, name: ["isDirty"] };
 * const state = useFormState(options);
 * form.setValue("theme", "dark");
 * console.log(state.isDirty); // true
 * ```
 * @since 1.0.0
 */
export interface UseFormStateOptions<TInput extends object, K extends keyof FormStateView> {
  /** The form to read. Default: the form of the nearest `<FormProvider>` or `<Form>`. */
  readonly form?: FormApi<TInput, unknown> | undefined;
  /** The parts of the state to return. Default: all of them (the form's own `formState`). */
  readonly name?: readonly K[] | undefined;
}

/**
 * The state of the form, limited to the parts you name. Each part is a getter over the form's own
 * accessor, so reading `state.isSubmitting` in an effect reruns it for submissions only.
 *
 * Read the parts through the returned object (`state.isSubmitting`) inside an effect or JSX:
 * destructuring reads each getter once, outside any subscription.
 *
 * @param options The parts to return and the form (see {@link UseFormStateOptions}). `form` may be
 *   omitted inside a `<FormProvider>` or `<Form>`. Default: `{}`.
 * @returns The picked parts as getters (see {@link FormStateView}).
 * @throws Error when no form is given and there is no provider above.
 * @example
 * ```tsx
 * import { useForm, useFormState } from "@shadow-js/forms";
 *
 * export function SubmitButton() {
 *   const form = useForm({ defaultValues: { title: "" } });
 *   const state = useFormState({ form, name: ["isSubmitting", "isDirty"] });
 *   return (
 *     <button type="submit" disabled={state.isSubmitting || !state.isDirty}>
 *       Publish
 *     </button>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function useFormState<
  TInput extends object = object,
  K extends keyof FormStateView = keyof FormStateView,
>(options?: UseFormStateOptions<TInput, K>): Pick<FormStateView, K>;
export function useFormState<TInput extends object, K extends keyof FormStateView>(
  options: UseFormStateOptions<TInput, K> = {},
): object {
  const form: FormApi<TInput, unknown> = options.form ?? useFormContext<TInput>();
  if (options.name === undefined) return form.formState;
  const picked: Partial<Record<keyof FormStateView, unknown>> = {};
  for (const key of options.name) {
    Object.defineProperty(picked, key, {
      enumerable: true,
      get: () => form.formState[key],
    });
  }
  return picked;
}

/**
 * The array helpers of {@link useFieldArray}: `fields()` and the operations on the list. The
 * operations are those of `form.fields(name)` (`FieldArrayApi`): an index out of range throws a
 * `RangeError`.
 *
 * @example
 * ```ts
 * import { useFieldArray, type UseFieldArrayResult, useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * const form = useForm({ id: "post", features: [fieldArrays], defaultValues: { tags: ["news"] } });
 * const tags: UseFieldArrayResult<string> = useFieldArray({ form, name: "tags" });
 * tags.append("sports");
 * tags.swap(0, 1);
 * console.log(tags.fields().map((row) => row.value())); // ["sports", "news"]
 * ```
 * @since 1.0.0
 */
export interface UseFieldArrayResult<I> {
  /** One row per item, in order. Reactive: it changes when the list does. */
  fields(): RowApi<I>[];
  /** Appends items. */
  append(...items: I[]): void;
  /** Prepends items. */
  prepend(...items: I[]): void;
  /** Inserts items before an index (`0` to the length). */
  insert(index: number, ...items: I[]): void;
  /** Removes the row at an index, or the rows at several indexes. */
  remove(index: number | readonly number[]): void;
  /** Moves a row from one index to another. */
  move(from: number, to: number): void;
  /** Swaps two rows. */
  swap(a: number, b: number): void;
  /** Replaces the item at an index; the row keeps its key. */
  update(index: number, item: I): void;
  /** Replaces the whole list. New rows get new keys. */
  replace(items: readonly I[]): void;
  /** Empties the list. */
  clear(): void;
}

/**
 * React Hook Form's `useFieldArray` by name: the rows as `fields()` (an accessor of row handles,
 * each with a stable `key`) and the list operations. It is `form.fields(name)` under that name.
 *
 * The form needs the `fieldArrays` feature from `@shadow-js/forms/arrays`.
 *
 * @param options The form (default: the nearest provider's form) and the array's path.
 * @returns The rows and the operations (see {@link UseFieldArrayResult}).
 * @throws TypeError when the form was created without the `fieldArrays` feature.
 * @throws Error when no form is given and there is no provider above.
 * @example
 * ```tsx
 * import { useFieldArray, useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * export function Tags() {
 *   const form = useForm({ features: [fieldArrays], defaultValues: { tags: [{ label: "news" }] } });
 *   const { fields, append, remove } = useFieldArray({ form, name: "tags" });
 *   return (
 *     <>
 *       {() =>
 *         fields().map((row) => (
 *           <div>
 *             <input {...row.field("label").props()} />
 *             <button type="button" onClick={() => remove(row.index())}>
 *               Remove
 *             </button>
 *           </div>
 *         ))
 *       }
 *       <button type="button" onClick={() => append({ label: "" })}>
 *         Add
 *       </button>
 *     </>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function useFieldArray<TInput extends object, P extends ArrayPath<TInput>>(options: {
  readonly form?: FormApi<TInput, unknown> | undefined;
  readonly name: P;
}): UseFieldArrayResult<ArrayItem<TInput, P>> {
  const form: FormApi<TInput, unknown> = options.form ?? useFormContext<TInput>();
  const array = fieldsOf<TInput>(form)(options.name);
  return {
    fields: () => array.keys().map((key) => array.row(key)),
    append: (...items) => array.append(...items),
    prepend: (...items) => array.prepend(...items),
    insert: (index, ...items) => array.insert(index, ...items),
    remove: (index) => array.remove(index),
    move: (from, to) => array.move(from, to),
    swap: (a, b) => array.swap(a, b),
    update: (index, item) => array.update(index, item),
    replace: (items) => array.replace(items),
    clear: () => array.clear(),
  };
}
