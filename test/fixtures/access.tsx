import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import { type FormApi, useForm } from "../../src/index";
import { submitErrors } from "../../src/submit-errors";

export interface AccessValues {
  first: string;
  email: string;
  interests: string[];
  agree: boolean;
  age: number | undefined;
  colors: string[];
}

export const accessDefaults = (): AccessValues => ({
  first: "",
  email: "",
  interests: [],
  agree: false,
  age: undefined,
  colors: [],
});

/** Text fields with their label, an error, an autocomplete hint and a checkbox group in a fieldset. */
export function Account(props: {
  onForm?: ((form: FormApi<AccessValues>) => void) | undefined;
  defaults?: Partial<AccessValues> | undefined;
}): JsxChild {
  const form = useForm<AccessValues>({
    id: "account",
    features: [submitErrors],
    defaultValues: { ...accessDefaults(), ...props.defaults },
    validators: { email: (value: string) => (value.includes("@") ? undefined : "Enter an email") },
  });
  props.onForm?.(form);
  const email = form.field("email").props();
  return (
    <form data-testid="account">
      <label for={form.field("first").props().id}>First name</label>
      <input
        data-testid="first"
        type="text"
        autocomplete="given-name"
        {...form.field("first").props()}
      />
      <label for={email.id}>Email</label>
      <input data-testid="email" type="email" autocomplete="email" {...email} />
      <p data-testid="email-error" id={form.field("email").errorId}>
        {form.field("email").error() ?? ""}
      </p>
      <fieldset data-testid="group">
        <legend>Interests</legend>
        <label>
          <input
            data-testid="reading"
            {...form.field("interests").props({ kind: "checkbox", value: "reading" })}
          />
          Reading
        </label>
        <label>
          <input
            data-testid="cooking"
            {...form.field("interests").props({ kind: "checkbox", value: "cooking" })}
          />
          Cooking
        </label>
        <label>
          <input
            data-testid="climbing"
            {...form.field("interests").props({ kind: "checkbox", value: "climbing" })}
          />
          Climbing
        </label>
      </fieldset>
    </form>
  );
}

/** Every control type that starts with a value, for the markup and hydration checks. */
export function Settings(props: {
  onForm?: ((form: FormApi<AccessValues>) => void) | undefined;
  defaults?: Partial<AccessValues> | undefined;
}): JsxChild {
  const form = useForm<AccessValues>({
    id: "settings",
    features: [submitErrors],
    defaultValues: { ...accessDefaults(), ...props.defaults },
  });
  props.onForm?.(form);
  return (
    <form data-testid="settings">
      <input data-testid="age" {...form.field("age").props({ kind: "number" })} />
      <select
        data-testid="colors"
        {...form.field("colors").props({ kind: "select", multiple: true })}
      >
        <option {...form.field("colors").optionProps("red")}>
          Red
        </option>
        <option {...form.field("colors").optionProps("green")}>
          Green
        </option>
        <option {...form.field("colors").optionProps("blue")}>
          Blue
        </option>
      </select>
      <input
        data-testid="reading"
        {...form.field("interests").props({ kind: "checkbox", value: "reading" })}
      />
      <input
        data-testid="cooking"
        {...form.field("interests").props({ kind: "checkbox", value: "cooking" })}
      />
      <input data-testid="agree" {...form.field("agree").props({ kind: "checkbox" })} />
    </form>
  );
}
