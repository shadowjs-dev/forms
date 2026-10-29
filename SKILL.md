---
name: shadowjs-forms
description: "Work with @shadow-js/forms. Forms with fine-grained values, schema validation, field arrays and server errors. Use when a project imports it, or when asked to add, configure or debug it."
---

# @shadow-js/forms

Version 1.0.2. Forms with fine-grained values, schema validation, field arrays and server errors.

## Where to read more

- @shadow-js/forms: https://forms.shadowjs.net
- Source and issues: https://github.com/shadowjs-dev/forms
- The package README is the full reference for options and behavior; read it before changing a configuration.

## Install

```sh
npm install @shadow-js/forms @shadow-js/core @shadow-js/web
```

## Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `@shadow-js/core` | `^1.0.2` | yes |
| `@shadow-js/web` | `^1.0.2` | yes |

## Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/forms`
- `@shadow-js/forms/server`
- `@shadow-js/forms/arrays`
- `@shadow-js/forms/async`
- `@shadow-js/forms/submit-errors`
- `@shadow-js/forms/standard-schema`
- `@shadow-js/forms/dates`
- `@shadow-js/forms/full`

## Quick start

```tsx
import { Field, Form, useForm } from "@shadow-js/forms";
import { standardSchema } from "@shadow-js/forms/standard-schema";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter an email"),
  age: z.coerce.number().min(18, "Adults only"),
  tags: z.array(z.object({ label: z.string().min(2) })),
});

export function Signup() {
  const form = useForm({
    resolver: standardSchema(schema), // the form holds z.input<typeof schema>; onSubmit receives z.output<typeof schema>
    defaultValues: { email: "", age: "", tags: [] },
    onSubmit: async (data) => {
      await save(data); // data.age is a number here
    },
  });
  const email = form.field("email"); // FieldApi<string>: the path is checked against the values
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

declare function save(data: z.output<typeof schema>): Promise<void>;
```

## Working rules

- Run `npm run check` before proposing a change; it lints, builds, type-checks and tests.
- Keep a public change documented: TSDoc on every exported symbol, and a CHANGELOG entry.
- To change this repository rather than use the package, read AGENTS.md: the layout, the commands, the rules and how a pull request is reviewed.
