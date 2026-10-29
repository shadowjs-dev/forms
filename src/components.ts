/**
 * Headless components: `<Form>`, `<Field>` and `<FieldArray>`. They render no markup of their own
 * except the `<form>` element, and depend on nothing but core and web.
 * @packageDocumentation
 */
import {
  type Accessor,
  type Context,
  createContext,
  mergeProps,
  splitProps,
  untrack,
  useContext,
} from "@shadow-js/core";
import { createComponent, Dynamic } from "@shadow-js/web";
import type { ComponentProps, JsxChild } from "@shadow-js/web/jsx-runtime";
import { fieldsOf } from "./internal/fields-of";
import type {
  ArrayItem,
  ArrayPath,
  FieldApi,
  FieldArrayApi,
  FieldStateView,
  FormApi,
  FormStateView,
  Path,
  PathValue,
  RowApi,
} from "./types";

/**
 * The context `<Form>` and `<FormProvider>` provide: the form, or `undefined` outside them. Most
 * code reads it with {@link useFormContext}, which throws instead of returning `undefined`; read
 * the context directly for a component that also works without a form.
 *
 * @example
 * ```tsx
 * import { useContext } from "@shadow-js/core";
 * import { FormContext } from "@shadow-js/forms";
 *
 * export function SubmitButton() {
 *   const form = useContext(FormContext);
 *   return (
 *     <button type="submit" disabled={form?.isSubmitting() === true}>
 *       Save
 *     </button>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export const FormContext: Context<FormApi<object, unknown> | undefined> = createContext<
  FormApi<object, unknown> | undefined
>(undefined, { name: "FormContext" });

/**
 * The form provided by the nearest `<Form>` or `<FormProvider>`, for components that render part
 * of a form without receiving it as a prop. The type arguments say which values the form holds;
 * they are not checked at run time.
 *
 * @returns The form.
 * @throws Error outside a `<Form>` or `<FormProvider>` (message `"[forms] this must be used inside a <Form>"`).
 * @example
 * ```tsx
 * import { useFormContext } from "@shadow-js/forms";
 *
 * export function EmailInput() {
 *   const form = useFormContext<{ email: string }>();
 *   const email = form.field("email");
 *   return <input type="email" {...email.props()} />;
 * }
 * ```
 * @see {@link FormContext}
 * @since 1.0.0
 */
export function useFormContext<TInput extends object, TOutput = TInput>(): FormApi<TInput, TOutput>;
export function useFormContext(): FormApi<object, unknown> {
  let found: FormApi<object, unknown> | undefined;
  try {
    found = useContext(FormContext);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    found = undefined;
  }
  if (found === undefined)
    throw new Error(__DEV__ ? "[forms] this must be used inside a <Form>" : "FORMS_NOFORM");
  return found;
}

/**
 * Props of {@link Form}: the `<form>` element's own attributes (except `ref`), plus the form. An
 * attribute given here overrides the one the form sets (`id`, `noValidate`); `onSubmit` runs
 * before the form's submit (see {@link Form}).
 *
 * @example
 * ```tsx
 * import { Form, type FormProps, useForm } from "@shadow-js/forms";
 *
 * export function SearchForm() {
 *   const form = useForm({ defaultValues: { query: "" } });
 *   const props: FormProps<{ query: string }> = { form, role: "search", class: "search" };
 *   return (
 *     <Form {...props}>
 *       <input type="search" {...form.field("query").props()} />
 *     </Form>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export type FormProps<TInput extends object, TOutput = TInput> = Omit<
  ComponentProps<"form">,
  "children" | "ref"
> & {
  /** The form returned by `useForm`. */
  readonly form: FormApi<TInput, TOutput>;
  /** The content of the `<form>` element. */
  readonly children?: JsxChild;
};

/**
 * A `<form>` wired to `form`: it submits through `form.handleSubmit`, turns off the browser's own
 * validation, and provides the form to `<Field>` / `<FieldArray>` / `useFormContext` below it.
 * Your own `onSubmit` runs first and can call `preventDefault()` to veto.
 *
 * @param props The form and the element's attributes (see {@link FormProps}).
 * @returns The `<form>` element inside the context provider.
 * @example
 * ```tsx
 * import { Field, Form, useForm } from "@shadow-js/forms";
 *
 * export function Newsletter() {
 *   const form = useForm({
 *     defaultValues: { email: "" },
 *     onSubmit: async (values) => {
 *       await fetch("/api/newsletter", { method: "POST", body: JSON.stringify(values) });
 *     },
 *   });
 *   return (
 *     <Form form={form} class="stack">
 *       <Field form={form} name="email">
 *         {(field) => <input type="email" {...field.props()} />}
 *       </Field>
 *       <button type="submit">Subscribe</button>
 *     </Form>
 *   );
 * }
 * ```
 * @see {@link FormProvider}
 * @since 1.0.0
 */
export function Form<TInput extends object, TOutput = TInput>(
  props: FormProps<TInput, TOutput>,
): JsxChild {
  const [local, rest] = splitProps(props, ["form", "onSubmit"]);
  const submit = (event: Event): void => {
    // The JSX handler type is wider than the DOM event this form passes it.
    const own = untrack(() => local.onSubmit) as ((event: Event) => void) | undefined;
    own?.(event);
    if (!event.defaultPrevented) void local.form.handleSubmit(event);
    else event.preventDefault();
  };
  const merged = mergeProps(local.form.props(), rest, { component: "form", onSubmit: submit });
  // `createComponent` is typed `unknown`; the element it returns is a JSX child.
  return createComponent(
    // The context holds the form as `FormApi<object, unknown>`; the provider's prop type says so.
    FormContext.Provider as (p: { value: unknown; children?: unknown }) => unknown,
    {
      value: local.form,
      get children() {
        return createComponent(Dynamic, merged);
      },
    },
  ) as JsxChild;
}

/**
 * Props of {@link Field} with a `form`: `name` is checked against the form's values and the field
 * has the type of that value.
 *
 * @example
 * ```tsx
 * import { Field, type FieldProps, useForm } from "@shadow-js/forms";
 *
 * interface Profile {
 *   name: string;
 * }
 *
 * export function NameField() {
 *   const form = useForm<Profile>({ defaultValues: { name: "" } });
 *   const props: FieldProps<Profile, Profile, "name"> = {
 *     form,
 *     name: "name",
 *     children: (field) => <input {...field.props()} />,
 *   };
 *   return <Field {...props} form={form} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface FieldProps<TInput extends object, TOutput, P extends Path<TInput>> {
  /** The form. Default: the form of the nearest `<Form>` or `<FormProvider>`. */
  readonly form?: FormApi<TInput, TOutput> | undefined;
  /** Path of the value. May change: the render function runs again for the new field. */
  readonly name: P;
  /** Renders the control from the field handle. */
  readonly children: (field: FieldApi<PathValue<TInput, P>>) => JsxChild;
}

/**
 * The value shape assumed when a component takes its form from the nearest `<Form>` and the
 * caller did not say which values it holds: any string is a path, and the value is `unknown`.
 *
 * @example
 * ```tsx
 * import { type ContextValues, Field } from "@shadow-js/forms";
 *
 * // Inside a <Form>: the same as <Field name="nickname">, any path is accepted.
 * export function NicknameField() {
 *   return (
 *     <Field<ContextValues> name="nickname">
 *       {(field) => <input {...field.props()} />}
 *     </Field>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export type ContextValues = Record<string, unknown>;

/**
 * Like {@link ContextValues} for {@link FieldArray}: any string is the path of an array whose
 * rows are objects with any keys.
 *
 * @example
 * ```tsx
 * import { type ContextArrays, FieldArray } from "@shadow-js/forms";
 *
 * // Inside a <Form> whose form has the fieldArrays feature.
 * export function PhoneList() {
 *   return (
 *     <FieldArray<ContextArrays> name="phones">
 *       {(row) => <input type="tel" {...row.field("number").props()} />}
 *     </FieldArray>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export type ContextArrays = Record<string, Record<string, unknown>[]>;

/**
 * Props of {@link Field} without a `form`: the form comes from the nearest `<Form>`, whose type
 * a component cannot see. `name` is any path unless you give the values type
 * (`<Field<Values> name="email">`), which then checks it.
 *
 * @example
 * ```tsx
 * import { type ContextFieldProps, Field } from "@shadow-js/forms";
 *
 * interface Values {
 *   email: string;
 * }
 *
 * // Inside a <Form>: the values type checks `name`.
 * export function EmailField() {
 *   const props: ContextFieldProps<Values, "email"> = {
 *     name: "email",
 *     children: (field) => <input type="email" {...field.props()} />,
 *   };
 *   return <Field<Values, "email"> {...props} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface ContextFieldProps<TInput extends object, P extends Path<TInput>> {
  /** Must be left out: the form is the nearest `<Form>` or `<FormProvider>`. */
  readonly form?: undefined;
  /** Path of the value. May change: the render function runs again for the new field. */
  readonly name: P;
  /** Renders the control from the field handle. */
  readonly children: (field: FieldApi<PathValue<TInput, P>>) => JsxChild;
}

/**
 * Renders a control for one field: the render function receives the field handle once (reads
 * inside it are reactive, the function itself does not re-run on typing).
 *
 * With `form`, the path is checked against the form's values and the field has the type of that
 * value. Without it, the form is the nearest `<Form>`; the component cannot know its values, so
 * `name` accepts any string and the field's value is `unknown`. Give the values type to get the
 * check back: `<Field<Values> name="email">` (the field then has the union of all value types).
 *
 * @param props The form (optional), the path and the render function (see {@link FieldProps} and
 *   {@link ContextFieldProps}).
 * @returns What the render function returns, rendered again when `name` changes.
 * @throws Error without `form` outside a `<Form>` or `<FormProvider>`.
 * @example
 * ```tsx
 * import { Field, useForm } from "@shadow-js/forms";
 *
 * export function PrimaryEmail() {
 *   const form = useForm({ defaultValues: { user: { emails: [{ address: "" }] } } });
 *   return (
 *     <Field form={form} name="user.emails.0.address">
 *       {(field) => (
 *         <>
 *           <input type="email" {...field.props()} />
 *           <p id={field.errorId}>{field.error()}</p>
 *         </>
 *       )}
 *     </Field>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function Field<TInput extends object, TOutput, P extends Path<TInput>>(
  props: FieldProps<TInput, TOutput, P> & { readonly form: FormApi<TInput, TOutput> },
): JsxChild;
export function Field<TInput extends object = ContextValues, P extends Path<TInput> = Path<TInput>>(
  props: ContextFieldProps<TInput, P>,
): JsxChild;
export function Field(props: {
  readonly form?: FormApi<object, unknown> | undefined;
  readonly name: string;
  readonly children: (field: FieldApi<unknown>) => JsxChild;
}): JsxChild {
  const form = props.form ?? useFormContext<object, unknown>();
  // An accessor child: it runs again only when `name` changes, never while the user types.
  return () => {
    const field = form.fieldAt(props.name);
    return untrack(() => props.children(field));
  };
}

/**
 * Props of {@link FieldArray} with a `form`: the path and the row type are checked against the
 * form's values.
 *
 * @example
 * ```tsx
 * import { FieldArray, type FieldArrayProps, useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * interface Contacts {
 *   emails: { address: string }[];
 * }
 *
 * export function EmailList() {
 *   const form = useForm({ features: [fieldArrays], defaultValues: { emails: [{ address: "" }] } });
 *   const props: FieldArrayProps<Contacts, Contacts, "emails"> = {
 *     form,
 *     name: "emails",
 *     children: (row) => <input type="email" {...row.field("address").props()} />,
 *     fallback: <p>No addresses yet.</p>,
 *   };
 *   return <FieldArray {...props} form={form} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface FieldArrayProps<TInput extends object, TOutput, P extends ArrayPath<TInput>> {
  /** The form. Default: the form of the nearest `<Form>` or `<FormProvider>`. */
  readonly form?: FormApi<TInput, TOutput> | undefined;
  /** Path of the array. */
  readonly name: P;
  /** Renders one row; it runs once per row, and the row keeps its DOM while the list changes. */
  readonly children: (row: RowApi<ArrayItem<TInput, P>>, index: Accessor<number>) => JsxChild;
  /** Shown while the list is empty. */
  readonly fallback?: JsxChild;
}

/**
 * Props of {@link FieldArray} without a `form`: the form comes from the nearest `<Form>`. `name`
 * is any path unless you give the values type (`<FieldArray<Values> name="emails">`), and a row
 * is an object with any keys (the union of all array items with the values type).
 *
 * @example
 * ```tsx
 * import { type ContextFieldArrayProps, FieldArray } from "@shadow-js/forms";
 *
 * interface Values {
 *   emails: { address: string }[];
 * }
 *
 * // Inside a <Form> whose form has the fieldArrays feature.
 * export function EmailRows() {
 *   const props: ContextFieldArrayProps<Values, "emails"> = {
 *     name: "emails",
 *     children: (row, index) => (
 *       <label>
 *         Email {index() + 1}
 *         <input type="email" {...row.field("address").props()} />
 *       </label>
 *     ),
 *   };
 *   return <FieldArray<Values, "emails"> {...props} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface ContextFieldArrayProps<TInput extends object, P extends ArrayPath<TInput>> {
  /** Must be left out: the form is the nearest `<Form>` or `<FormProvider>`. */
  readonly form?: undefined;
  /** Path of the array. */
  readonly name: P;
  /** Renders one row; it runs once per row, and the row keeps its DOM while the list changes. */
  readonly children: (row: RowApi<ArrayItem<TInput, P>>, index: Accessor<number>) => JsxChild;
  /** Shown while the list is empty. */
  readonly fallback?: JsxChild;
}

/**
 * Renders the rows of an array with stable keys: adding, removing or moving rows never rebuilds
 * the rows around them, so their focus and typing state stay. Typed like {@link Field}: with
 * `form` the path and the row are exact; without it the form is the nearest `<Form>`. The form
 * needs the `fieldArrays` feature from `@shadow-js/forms/arrays`.
 *
 * @param props The form (optional), the array's path, the row render function and the fallback
 *   (see {@link FieldArrayProps} and {@link ContextFieldArrayProps}).
 * @returns The rendered rows, or `fallback` while the list is empty.
 * @throws TypeError when the form was created without the `fieldArrays` feature.
 * @throws Error without `form` outside a `<Form>` or `<FormProvider>`.
 * @example
 * ```tsx
 * import { FieldArray, Form, useForm } from "@shadow-js/forms";
 * import { fieldArrays } from "@shadow-js/forms/arrays";
 *
 * export function Emails() {
 *   const form = useForm({ features: [fieldArrays], defaultValues: { emails: [{ address: "" }] } });
 *   return (
 *     <Form form={form}>
 *       <FieldArray form={form} name="emails" fallback={<p>No emails yet.</p>}>
 *         {(row) => (
 *           <div>
 *             <input type="email" {...row.field("address").props()} />
 *             <button type="button" onClick={() => row.remove()}>
 *               Remove
 *             </button>
 *           </div>
 *         )}
 *       </FieldArray>
 *       <button type="button" onClick={() => form.fields("emails").append({ address: "" })}>
 *         Add
 *       </button>
 *     </Form>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function FieldArray<TInput extends object, TOutput, P extends ArrayPath<TInput>>(
  props: FieldArrayProps<TInput, TOutput, P> & { readonly form: FormApi<TInput, TOutput> },
): JsxChild;
export function FieldArray<
  TInput extends object = ContextArrays,
  P extends ArrayPath<TInput> = ArrayPath<TInput>,
>(props: ContextFieldArrayProps<TInput, P>): JsxChild;
export function FieldArray(props: {
  readonly form?: FormApi<object, unknown> | undefined;
  readonly name: string;
  readonly children: (row: RowApi<unknown>, index: Accessor<number>) => JsxChild;
  readonly fallback?: JsxChild;
}): JsxChild {
  const form = props.form ?? useFormContext<object, unknown>();
  // Justified cast: the untyped form's fields take any path, and the rows are untyped here.
  const array = fieldsOf<ContextArrays>(form)(props.name) as FieldArrayApi<unknown>;
  const rows = array.each((row, index) => untrack(() => props.children(row, index)));
  return () => {
    const list = rows();
    return list.length === 0 ? untrack(() => props.fallback) : list;
  };
}

/**
 * Props of {@link FormProvider}.
 *
 * @example
 * ```tsx
 * import { FormProvider, type FormProviderProps, useForm } from "@shadow-js/forms";
 *
 * export function ProfileSection() {
 *   const form = useForm({ defaultValues: { name: "" } });
 *   const props: FormProviderProps<{ name: string }> = {
 *     form,
 *     children: <input {...form.field("name").props()} />,
 *   };
 *   return <FormProvider {...props} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface FormProviderProps<TInput extends object, TOutput = TInput> {
  /** The form the subtree uses through {@link useFormContext}, `useWatch` and the `Field`s. */
  readonly form: FormApi<TInput, TOutput>;
  /** The subtree that sees the form. */
  readonly children?: JsxChild;
}

/**
 * Provides a form to a subtree without rendering a `<form>` element. Use it when the fields are
 * spread over components that do not own the submit button or the `<form>`. `<Form>` provides the
 * same context and also renders the element.
 *
 * @param props The form and the subtree (see {@link FormProviderProps}).
 * @returns The children inside the context provider.
 * @example
 * ```tsx
 * import { FormProvider, useForm, useFormContext } from "@shadow-js/forms";
 *
 * function NameField() {
 *   const form = useFormContext<{ name: string }>();
 *   return <input {...form.field("name").props()} />;
 * }
 *
 * export function Settings() {
 *   const form = useForm({ defaultValues: { name: "" } });
 *   return (
 *     <FormProvider form={form}>
 *       <NameField />
 *       <button type="button" onClick={() => void form.handleSubmit()}>
 *         Save
 *       </button>
 *     </FormProvider>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function FormProvider<TInput extends object, TOutput = TInput>(
  props: FormProviderProps<TInput, TOutput>,
): JsxChild {
  // `createComponent` is typed `unknown`; the element it returns is a JSX child.
  return createComponent(
    // The context holds the form as `FormApi<object, unknown>`; the provider's prop type says so.
    FormContext.Provider as (p: { value: unknown; children?: unknown }) => unknown,
    {
      value: props.form,
      get children() {
        return props.children;
      },
    },
  ) as JsxChild;
}

/**
 * The field a {@link Controller} render function receives: the handle of a custom control.
 * `value()` is reactive; `onChange` takes a value or the control's event.
 *
 * @example
 * ```tsx
 * import { Controller, type ControllerField, useForm } from "@shadow-js/forms";
 *
 * function Stars(props: { field: ControllerField<number> }) {
 *   return (
 *     <div role="radiogroup" id={props.field.id} onBlur={() => props.field.onBlur()}>
 *       {[1, 2, 3, 4, 5].map((stars) => (
 *         <button type="button" aria-pressed={props.field.value() >= stars} onClick={() => props.field.onChange(stars)}>
 *           {stars}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 *
 * export function Review() {
 *   const form = useForm({ defaultValues: { rating: 3 } });
 *   return <Controller form={form} name="rating" render={({ field }) => <Stars field={field} />} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface ControllerField<V> {
  /** The path of the value. */
  readonly name: string;
  /** The id the control should use. */
  readonly id: string;
  /** Whether the field is disabled. */
  disabled(): boolean;
  /** The current value (reactive). */
  value(): V;
  /** Writes a value (validating as the form's rules say), or reads the event's control and writes what it holds. */
  onChange(next: V | Event): void;
  /** Marks the field touched and validates it as `validateOn` / `reValidateOn` say. */
  onBlur(): void;
  /** Registers the element (optional for a control that has no element). */
  ref(element: Element | null): void;
}

/**
 * What a {@link Controller} render function receives.
 *
 * @example
 * ```tsx
 * import { Controller, type ControllerRender, useForm } from "@shadow-js/forms";
 *
 * function renderAmount({ field, fieldState }: ControllerRender<number>) {
 *   return (
 *     <>
 *       <input
 *         id={field.id}
 *         inputmode="decimal"
 *         value={String(field.value())}
 *         onInput={(event) => field.onChange(Number((event.currentTarget as HTMLInputElement).value))}
 *         onBlur={() => field.onBlur()}
 *       />
 *       <p>{fieldState.error}</p>
 *     </>
 *   );
 * }
 *
 * export function Donation() {
 *   const form = useForm({ defaultValues: { amount: 10 } });
 *   return <Controller form={form} name="amount" render={renderAmount} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface ControllerRender<V> {
  /** The field handle for the control. */
  readonly field: ControllerField<V>;
  /** The field's state as getters (see `FieldStateView`). */
  readonly fieldState: FieldStateView;
  /** The form's state as getters (see `FormStateView`). */
  readonly formState: FormStateView;
}

/**
 * Props of {@link Controller}.
 *
 * @example
 * ```tsx
 * import { Controller, type ControllerProps, useForm } from "@shadow-js/forms";
 *
 * interface Settings {
 *   darkMode: boolean;
 * }
 *
 * export function DarkModeSwitch() {
 *   const form = useForm<Settings>({ defaultValues: { darkMode: false } });
 *   const props: ControllerProps<Settings, Settings, "darkMode"> = {
 *     form,
 *     name: "darkMode",
 *     render: ({ field }) => (
 *       <button type="button" role="switch" aria-checked={field.value()} onClick={() => field.onChange(!field.value())}>
 *         Dark mode
 *       </button>
 *     ),
 *   };
 *   return <Controller {...props} />;
 * }
 * ```
 * @since 1.0.0
 */
export interface ControllerProps<TInput extends object, TOutput, P extends Path<TInput>> {
  /** The form. Default: the form of the nearest `<Form>` or `<FormProvider>`. */
  readonly form?: FormApi<TInput, TOutput> | undefined;
  /** Path of the value. Read once, when the controller is created. */
  readonly name: P;
  /** Renders the control. It runs once; reads inside it are reactive. */
  readonly render: (props: ControllerRender<PathValue<TInput, P>>) => JsxChild;
}

/**
 * React Hook Form's `Controller` for custom controls: the render function gets a field handle
 * (`value()`, `onChange`, `onBlur`, `ref`) and the field and form state. It runs once; a keystroke
 * updates only the reads inside the render.
 *
 * @param props The form (optional), the path and the render function (see {@link ControllerProps}).
 * @returns What the render function returns.
 * @throws Error without `form` outside a `<Form>` or `<FormProvider>`.
 * @example
 * ```tsx
 * import { Controller, useForm } from "@shadow-js/forms";
 *
 * export function CountryChoice() {
 *   const form = useForm({ defaultValues: { country: "de" } });
 *   return (
 *     <Controller
 *       form={form}
 *       name="country"
 *       render={({ field, fieldState }) => (
 *         <>
 *           <select id={field.id} ref={field.ref} value={field.value()} onChange={field.onChange} onBlur={() => field.onBlur()}>
 *             <option value="de">Germany</option>
 *             <option value="fr">France</option>
 *           </select>
 *           <p>{fieldState.error}</p>
 *         </>
 *       )}
 *     />
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function Controller<
  TInput extends object = ContextValues,
  TOutput = TInput,
  P extends Path<TInput> = Path<TInput>,
>(props: ControllerProps<TInput, TOutput, P>): JsxChild {
  // Justified cast: the render function's form is the caller's `TInput`; this component reads it as
  // untyped values.
  const form = (props.form ?? useFormContext<object, unknown>()) as FormApi<object, unknown>;
  const name: string = props.name;
  return () => {
    const field = form.fieldAt(name);
    const handle: ControllerField<unknown> = {
      name,
      get id() {
        return field.id;
      },
      disabled: () => field.disabled(),
      value: () => field.value(),
      onChange(next: unknown) {
        if (next instanceof Event) field.onInput(next);
        else field.setValue(next);
      },
      onBlur: () => field.onBlur(),
      ref: (element) => field.ref(element),
    };
    const fieldState = form.getFieldState(name);
    return untrack(() =>
      props.render({
        // Justified cast: the handle reads the field untyped; the render function gets the path's type.
        field: handle as ControllerField<PathValue<TInput, P>>,
        fieldState,
        formState: form.formState,
      }),
    );
  };
}
