import type { JsxChild } from "@shadow-js/web/jsx-runtime";
import {
  Controller,
  Form,
  FormProvider,
  type FormApi,
  useFieldArray,
  useForm,
  useWatch,
} from "../../src/index";
import { fieldArrays } from "../../src/arrays";
import { asyncValidation } from "../../src/async";
import { submitErrors } from "../../src/submit-errors";

export interface RhfValues {
  name: string;
  address: { city: string; zip?: string };
  tags: { label: string }[];
}

export const seen = { controllerRenders: 0, watched: [] as string[] };

function WatchCity(): JsxChild {
  const city = useWatch<string>({ name: "address.city", defaultValue: "none" });
  return <output data-testid="city">{() => city()}</output>;
}

/** A form provided by `FormProvider`, with no `<Form>` element anywhere. */
export function Provided(props: {
  onForm?: ((form: FormApi<RhfValues>) => void) | undefined;
}): JsxChild {
  const form = useForm<RhfValues>({ features: [fieldArrays, asyncValidation, submitErrors],
    id: "provided",
    defaultValues: { name: "Ada", address: { city: "London" }, tags: [] },
  });
  props.onForm?.(form);
  return (
    <FormProvider form={form}>
      <WatchCity />
    </FormProvider>
  );
}

/** A custom control: `Controller` hands it the field handle and the field state. */
export function Custom(props: {
  onForm?: ((form: FormApi<RhfValues>) => void) | undefined;
}): JsxChild {
  const form = useForm<RhfValues>({ features: [fieldArrays, asyncValidation, submitErrors],
    id: "custom",
    defaultValues: { name: "Ada", address: { city: "London" }, tags: [] },
  });
  props.onForm?.(form);
  return (
    <Form form={form} data-testid="custom-form">
      <Controller
        form={form}
        name="name"
        render={({ field, fieldState }) => {
          seen.controllerRenders += 1;
          return (
            <span>
              <input
                data-testid="custom"
                value={field.value()}
                onInput={(event: Event) =>
                  field.onChange((event.target as HTMLInputElement).value)
                }
                onBlur={() => field.onBlur()}
              />
              <em data-testid="custom-error">{() => fieldState.error ?? ""}</em>
            </span>
          );
        }}
      />
    </Form>
  );
}

/** Keeps `useFieldArray` in a component, so its rows render like a list. */
export function Tags(props: { onArray?: ((array: unknown) => void) | undefined }): JsxChild {
  const form = useForm<RhfValues>({ features: [fieldArrays, asyncValidation, submitErrors],
    id: "tags",
    defaultValues: { name: "", address: { city: "" }, tags: [{ label: "a" }] },
  });
  const array = useFieldArray({ form, name: "tags" });
  props.onArray?.(array);
  return (
    <ul data-testid="tags">
      {() => array.fields().map((row) => <li data-testid="tag">{row.key}</li>)}
    </ul>
  );
}
