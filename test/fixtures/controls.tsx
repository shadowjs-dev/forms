import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import { type FormApi, type FormOptions, useForm } from "../../src/index";
import { fieldArrays } from "../../src/arrays";
import { asyncValidation } from "../../src/async";
import { submitErrors } from "../../src/submit-errors";
import { dates } from "../../src/dates";

export interface ControlValues {
  name: string;
  age: number | undefined;
  agree: boolean;
  plan: string;
  color: string;
  colors: string[];
  bio: string;
  birthday: string;
  when: Date | undefined;
  interests: string[];
  avatar: File | undefined;
  docs: File[];
}

export const controlDefaults = (): ControlValues => ({
  name: "",
  age: undefined,
  agree: false,
  plan: "free",
  color: "red",
  colors: ["red"],
  bio: "",
  birthday: "",
  when: undefined,
  interests: [],
  avatar: undefined,
  docs: [],
});

/** One of every native control, bound with `field.props()`. */
export function Controls(props: {
  onForm?: ((form: FormApi<ControlValues>) => void) | undefined;
  options?: Partial<FormOptions<ControlValues>> | undefined;
}): JsxChild {
  const form = useForm<ControlValues>({ features: [fieldArrays, asyncValidation, submitErrors, dates],
    defaultValues: controlDefaults(),
    ...props.options,
  });
  props.onForm?.(form);
  const name = form.field("name");
  const plan = form.field("plan");
  const interests = form.field("interests");
  return (
    <form {...form.props()} data-testid="form">
      <input data-testid="name" {...name.props()} />
      <input data-testid="name-twin" {...name.props()} />
      <p data-testid="name-error" id={name.errorId}>
        {name.error()}
      </p>
      <input data-testid="age" {...form.field("age").props({ kind: "number" })} />
      <input data-testid="agree" {...form.field("agree").props({ kind: "checkbox" })} />
      <input data-testid="plan-free" {...plan.props({ kind: "radio", value: "free" })} />
      <input data-testid="plan-pro" {...plan.props({ kind: "radio", value: "pro" })} />
      <select data-testid="color" {...form.field("color").props({ kind: "select" })}>
        <option value="red">Red</option>
        <option value="green">Green</option>
        <option value="blue">Blue</option>
      </select>
      <select
        data-testid="colors"
        {...form.field("colors").props({ kind: "select", multiple: true })}
      >
        <option value="red">Red</option>
        <option value="green">Green</option>
        <option value="blue">Blue</option>
      </select>
      <textarea data-testid="bio" {...form.field("bio").props({ kind: "textarea" })} />
      <input data-testid="birthday" {...form.field("birthday").props({ kind: "date" })} />
      <input
        data-testid="when"
        {...form.field("when").props({ kind: "date", type: "datetime-local", as: "date" })}
      />
      <input data-testid="int-a" {...interests.props({ kind: "checkbox", value: "a" })} />
      <input data-testid="int-b" {...interests.props({ kind: "checkbox", value: "b" })} />
      <input data-testid="avatar" {...form.field("avatar").props({ kind: "file" })} />
      <input data-testid="docs" {...form.field("docs").props({ kind: "file", multiple: true })} />
    </form>
  );
}

/** A text input whose handler rejects non-letters by writing the old value back. */
export function Masked(props: { onForm?: (form: FormApi<{ code: string }>) => void }): JsxChild {
  const form = useForm<{ code: string }>({ features: [fieldArrays, asyncValidation, submitErrors, dates], defaultValues: { code: "AB" } });
  props.onForm?.(form);
  const code = form.field("code");
  return (
    <input
      data-testid="code"
      {...code.props()}
      onInput={(event) => {
        const input = event.currentTarget;
        if (/^[A-Za-z]*$/.test(input.value)) code.onInput(event);
        else code.setValue(code.value());
      }}
    />
  );
}
