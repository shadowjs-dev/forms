import { useSignal } from "@shadow-js/core";
import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import {
  Field,
  FieldArray,
  type FieldArraysApi,
  Form,
  type FormApi,
  useForm,
  useFormContext,
} from "../../src/index";
import { fieldArrays } from "../../src/arrays";
import { asyncValidation } from "../../src/async";
import { submitErrors } from "../../src/submit-errors";

export interface ProfileValues {
  name: string;
  emails: { address: string }[];
}

export const counters = { name: 0, rows: 0 };

function ContextName(): JsxChild {
  const form = useFormContext<ProfileValues>();
  return <output data-testid="context-name">{form.field("name").value()}</output>;
}

/** A form made only of the headless components. */
export function Profile(props: {
  onForm?: ((form: FormApi<ProfileValues> & FieldArraysApi<ProfileValues>) => void) | undefined;
  onSubmit?: ((event: Event) => void) | undefined;
  initial?: ProfileValues | undefined;
  errors?: Record<string, string> | undefined;
}): JsxChild {
  const form = useForm<ProfileValues>({ features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: props.initial ?? { name: "", emails: [{ address: "a@x" }, { address: "b@x" }] },
    validators: { "emails.*.address": (v: string) => (v.includes("@") ? undefined : "Needs @") },
    initialErrors: props.errors,
    onSubmit: () => undefined,
  });
  props.onForm?.(form);
  return (
    <Form form={form} data-testid="form" class="profile" onSubmit={props.onSubmit}>
      <Field form={form} name="name">
        {(field) => {
          counters.name += 1;
          return <input data-testid="name" {...field.props()} />;
        }}
      </Field>
      <ContextName />
      <ul data-testid="list">
        <FieldArray
          form={form}
          name="emails"
          fallback={<li data-testid="empty">No emails</li>}
        >
          {(row, index) => {
            counters.rows += 1;
            return (
              <li data-testid="row" data-key={row.key}>
                <span data-testid="index">{index() + 1}</span>
                <input data-testid="address" {...row.field("address").props()} />
                <em data-testid="error">{row.field("address").error()}</em>
                <button type="button" data-testid="remove" onClick={() => row.remove()}>
                  remove
                </button>
              </li>
            );
          }}
        </FieldArray>
      </ul>
      <button type="submit" data-testid="submit">
        Save
      </button>
    </Form>
  );
}

/** `useFormContext` outside a `<Form>`. */
export function Orphan(): JsxChild {
  useFormContext();
  return <p>never</p>;
}

/** A `<Field>` whose name is a signal. */
export function Switcher(props: {
  onReady?:
    | ((
        form: FormApi<{ a: string; b: string }> & FieldArraysApi<{ a: string; b: string }>,
        pick: (name: "a" | "b") => void,
      ) => void)
    | undefined;
}): JsxChild {
  const form = useForm<{ a: string; b: string }>({ features: [fieldArrays, asyncValidation, submitErrors], defaultValues: { a: "A", b: "B" } });
  const [which, setWhich] = useSignal<"a" | "b">("a");
  props.onReady?.(form, setWhich);
  return (
    <Field form={form} name={which()}>
      {(field) => <input data-testid="x" {...field.props()} />}
    </Field>
  );
}
