// Type tests for control bags and the components: bags spread onto native elements without casts.
import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import {
  bind,
  Field,
  type FieldApi,
  FieldArray,
  Form,
  type NumberControlProps,
  type RadioControlProps,
  type TextareaControlProps,
  type TextControlProps,
  useForm,
} from "../src/index";
import { submitErrors } from "../src/submit-errors";

interface Values {
  name: string;
  age: number | undefined;
  agree: boolean;
  plan: string;
  colors: string[];
  bio: string;
  born: string;
  avatar: File | undefined;
  rows: { sku: string }[];
}

export function Demo(): JsxChild {
  const form = useForm<Values>({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: {},
  });
  const name = form.field("name");
  return (
    <Form form={form} class="stack">
      <input {...name.props()} />
      <input {...form.field("age").props({ kind: "number" })} />
      <input {...form.field("agree").props({ kind: "checkbox" })} />
      <input {...form.field("colors").props({ kind: "checkbox", value: "red" })} />
      <input {...form.field("plan").props({ kind: "radio", value: "free" })} />
      <select {...form.field("plan").props({ kind: "select" })}>
        <option {...form.field("plan").optionProps("free")}>Free</option>
      </select>
      <select {...form.field("colors").props({ kind: "select", multiple: true })} />
      <textarea {...form.field("bio").props({ kind: "textarea" })} />
      <input {...form.field("born").props({ kind: "date" })} />
      <input {...form.field("avatar").props({ kind: "file" })} />
      <input {...bind(form.field("age"), "number")} />
      <input {...bind(form.field("plan"), { kind: "radio", value: "pro" })} />
      <Field form={form} name="name">
        {(field) => <input {...field.props()} />}
      </Field>
      <Field form={form} name="rows.0.sku">
        {(field) => <p>{field.value()}</p>}
      </Field>
      <FieldArray form={form} name="rows">
        {(row) => <input {...row.field("sku").props()} />}
      </FieldArray>
      {/* @ts-expect-error a misspelt field name */}
      <Field form={form} name="nmae">
        {(field) => <input {...field.props()} />}
      </Field>
      {/* @ts-expect-error a field that is not an array */}
      <FieldArray form={form} name="name">
        {() => <li />}
      </FieldArray>
    </Form>
  );
}

declare const field: FieldApi<string>;
export const text: TextControlProps = field.props();
export const textarea: TextareaControlProps = field.props({ kind: "textarea" });
export const number: NumberControlProps = field.props({
  kind: "number",
  empty: "null",
  invalid: "nan",
});
export const radio: RadioControlProps = field.props({ kind: "radio", value: "a" });
// @ts-expect-error a radio button needs its value
field.props({ kind: "radio" });
// @ts-expect-error unknown kind
field.props({ kind: "slider" });
// @ts-expect-error an option the kind does not have
field.props({ kind: "number", trim: true });
// @ts-expect-error a number control has no onChange
export const noChange: unknown = field.props({ kind: "number" }).onChange;
// @ts-expect-error bind with a radio needs options, not just the kind
bind(field, "radio");

// `<Field>` / `<FieldArray>` without a `form`: the form comes from the nearest `<Form>`, so `name`
// is any path and the value is `unknown` unless the values type is given.
export function InsideForm(): JsxChild {
  return (
    <>
      <Field name="anything.at.all">{(field) => <input {...field.props()} />}</Field>
      <Field name="email">
        {(field) => {
          const value: unknown = field.value();
          return <input {...field.props()} data-v={String(value)} />;
        }}
      </Field>
      <FieldArray name="rows" fallback={<p>none</p>}>
        {(row, index) => <input {...row.field("sku").props()} data-i={index()} />}
      </FieldArray>
      <Field<Values> name="rows.0.sku">{(field) => <input {...field.props()} />}</Field>
      <FieldArray<Values> name="rows">
        {(row) => <input {...row.field("sku").props()} />}
      </FieldArray>
      {/* @ts-expect-error with the values type given, a misspelt path is rejected */}
      <Field<Values> name="nmae">{(field) => <input {...field.props()} />}</Field>
      {/* @ts-expect-error with the values type given, a path that is not an array is rejected */}
      <FieldArray<Values> name="name">{() => <li />}</FieldArray>
      {/* @ts-expect-error a name is required */}
      <Field>{(field) => <input {...field.props()} />}</Field>
    </>
  );
}
