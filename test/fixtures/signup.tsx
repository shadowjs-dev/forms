import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import { type FormApi, type IssueInput, useForm } from "../../src/index";
import { fieldArrays } from "../../src/arrays";
import { asyncValidation } from "../../src/async";
import { submitErrors } from "../../src/submit-errors";

export interface SignupValues {
  email: string;
  plan: string;
  agree: boolean;
  tags: string[];
  note: string;
}

export const state: { form: FormApi<SignupValues> | undefined } = { form: undefined };

/** A form rendered on the server (a no-JavaScript post answered with problems) and hydrated. */
export function Signup(props: {
  values?: SignupValues | undefined;
  errors?: Record<string, IssueInput | readonly IssueInput[]> | undefined;
}): JsxChild {
  const form = useForm<SignupValues>({ features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: props.values ?? { email: "", plan: "free", agree: false, tags: [], note: "" },
    initialErrors: props.errors,
  });
  state.form = form;
  const email = form.field("email");
  const plan = form.field("plan");
  const note = form.field("note");
  return (
    <form {...form.props()} method="post" data-testid="form">
      <label for={email.id}>Email</label>
      <input data-testid="email" {...email.props()} type="email" />
      <p data-testid="email-error" id={email.errorId}>
        {email.error()}
      </p>
      <input data-testid="free" {...plan.props({ kind: "radio", value: "free" })} />
      <input data-testid="pro" {...plan.props({ kind: "radio", value: "pro" })} />
      <input data-testid="agree" {...form.field("agree").props({ kind: "checkbox" })} />
      <select data-testid="plan-select" {...plan.props({ kind: "select" })}>
        <option {...plan.optionProps("free")}>Free</option>
        <option {...plan.optionProps("pro")}>Pro</option>
      </select>
      <textarea data-testid="note" {...note.props({ kind: "textarea" })} />
      <p data-testid="form-error">{form.formErrors()[0]?.message}</p>
    </form>
  );
}
