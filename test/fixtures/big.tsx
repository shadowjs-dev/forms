import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import {
  FieldArray,
  type FieldArraysApi,
  type FormApi,
  type FormOptions,
  type StandardSchemaV1,
  useForm,
} from "../../src/index";
import { standardSchema } from "../../src/standard-schema";
import { fieldArrays } from "../../src/arrays";
import { asyncValidation } from "../../src/async";
import { submitErrors } from "../../src/submit-errors";

/** A form of `count` text inputs. */
export function Wide(props: {
  count: number;
  schema?: StandardSchemaV1<Record<string, string>, unknown> | undefined;
  onForm?: ((form: FormApi<Record<string, string>> & FieldArraysApi<Record<string, string>>) => void) | undefined;
  options?: Partial<FormOptions<Record<string, string>>> | undefined;
}): JsxChild {
  const names = Array.from({ length: props.count }, (_, i) => `f${i}`);
  const form = useForm<Record<string, string>>({ features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: Object.fromEntries(names.map((name) => [name, ""])),
    ...(props.schema === undefined ? {} : { resolver: standardSchema(props.schema) as never }),
    ...props.options,
  });
  props.onForm?.(form);
  return (
    <form {...form.props()}>
      {names.map((name) => (
        <div data-field={name}>
          <input data-name={name} {...form.field(name).props()} />
          <span data-error={name}>{form.field(name).error()}</span>
        </div>
      ))}
    </form>
  );
}

interface Rows {
  rows: { a: string; b: string }[];
}

/** A list of `count` rows with two inputs each. */
export function Long(props: {
  count: number;
  onForm?: ((form: FormApi<Rows> & FieldArraysApi<Rows>) => void) | undefined;
}): JsxChild {
  const form = useForm<Rows>({ features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: {
      rows: Array.from({ length: props.count }, (_, i) => ({ a: `a${i}`, b: `b${i}` })),
    },
  });
  props.onForm?.(form);
  return (
    <form {...form.props()}>
      <ul data-testid="list">
        <FieldArray form={form} name="rows">
          {(row) => (
            <li data-row={row.key}>
              <input {...row.field("a").props()} />
              <input {...row.field("b").props()} />
            </li>
          )}
        </FieldArray>
      </ul>
    </form>
  );
}
