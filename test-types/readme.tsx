// The README's examples, type-checked as written.
import { useSignal } from "@shadow-js/core";
import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import { z } from "zod";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import {
  applyServerErrors,
  Field,
  FieldArray,
  Form,
  FormSubmitError,
  submitWith,
  useForm,
  useUnsavedChangesGuard,
  useWizard,
} from "../src/index";
import { formDataToValues, parseFormData } from "../src/server";
import { standardSchema } from "../src/standard-schema";
import { submitErrors } from "../src/submit-errors";

const schema = z.object({
  email: z.string().email("Enter an email"),
  age: z.coerce.number().min(18, "Adults only"),
  tags: z.array(z.object({ label: z.string().min(2) })),
});

declare function save(data: z.output<typeof schema>): Promise<void>;

export function Signup(): JsxChild {
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    resolver: standardSchema(schema),
    defaultValues: { email: "", age: "", tags: [] },
    onSubmit: async (data) => {
      const age: number = data.age;
      void age;
      await save(data);
    },
  });
  const email = form.field("email");
  return (
    <Form form={form} class="space-y-4">
      <input type="email" {...email.props()} />
      <p id={email.errorId}>{email.error()}</p>
      <Field form={form} name="age">
        {(age) => <input inputmode="numeric" {...age.props()} />}
      </Field>
      <button type="submit" disabled={form.isSubmitting()}>
        Create account
      </button>
    </Form>
  );
}

export function Emails(): JsxChild {
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: { emails: [{ address: "" }] },
  });
  return (
    <Form form={form}>
      <FieldArray form={form} name="emails" fallback={<p>No emails yet.</p>}>
        {(row) => (
          <div>
            <input {...row.field("address").props()} />
            <button type="button" onClick={() => row.remove()}>
              Remove
            </button>
          </div>
        )}
      </FieldArray>
      <button type="button" onClick={() => form.fields("emails").append({ address: "" })}>
        Add
      </button>
    </Form>
  );
}

declare function createUser(input: { email: string }): Promise<{ id: string }>;

export function actions(): void {
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    id: "signup",
    defaultValues: { email: "" },
    onSubmit: submitWith(createUser, (user) => console.log(user.id)),
  });
  async function manual(): Promise<void> {
    try {
      await createUser({ email: form.getValues("email") });
    } catch (error) {
      if (!applyServerErrors(form, error).applied) throw error;
    }
  }
  async function post(request: Request): Promise<unknown> {
    const data = await request.formData();
    const result = await parseFormData(schema, data, { defaults: { email: "" } });
    if (!result.success) return { errors: result.errors, values: result.values };
    return { data: result.data };
  }
  void [manual, post, FormSubmitError, formDataToValues];
}

export function steps(): void {
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: { email: "", profile: { first: "" } },
  });
  const wizard = useWizard(form, {
    steps: [
      { id: "account", fields: ["email"] },
      { id: "profile", fields: ["profile"] },
    ],
    persistKey: "signup",
  });
  const guard = useUnsavedChangesGuard(form);
  const [count] = useSignal(wizard.index());
  void [guard.blocker({ to: "/x" }), count];
}

export function actionsAsWritten(): void {
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    id: "signup",
    defaultValues: { email: "" },
    onSubmit: submitWith(createUser, (user) => console.log(user.id)),
  });
  const own = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: { email: "" },
    onSubmit: () => {
      throw new FormSubmitError("Could not save", { fieldErrors: { email: "Already registered" } });
    },
  });
  void [form, own];
}

const simple = z.object({ email: z.string().email() });

export async function postAsWritten(request: Request): Promise<unknown> {
  const data = await request.formData();
  const result = await parseFormData(simple, data, { defaults: { email: "" } });
  if (!result.success) return { errors: result.errors, values: result.values };
  return { saved: await createUser(result.data), raw: formDataToValues(data) };
}
