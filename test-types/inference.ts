// Type tests: valid usage compiles and infers what it should; misuse is rejected by
// `@ts-expect-error` (an unused directive is itself an error). Each scenario is a function so
// that its variables are inferred (a top-level export would need an annotation).
import { z } from "zod";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import {
  type FieldApi,
  type FieldArrayApi,
  type FormApi,
  type Path,
  type PathValue,
  type RowApi,
  type StandardSchemaV1,
  useForm,
} from "../src/index";
import { standardSchema } from "../src/standard-schema";
import { submitErrors } from "../src/submit-errors";
import type { Equal, Expect } from "./support";

interface User {
  name: string;
  age: number;
  user: { emails: { address: string; primary?: boolean }[]; tags: string[] };
  when: Date;
  maybe?: { deep: { x: number } };
}

type Paths = Path<User>;

export const pathChecks: [
  Expect<Equal<"name" extends Paths ? true : false, true>>,
  Expect<Equal<"user.emails.0.address" extends Paths ? true : false, true>>,
  Expect<Equal<"user.emails.12.primary" extends Paths ? true : false, true>>,
  Expect<Equal<"user.tags.3" extends Paths ? true : false, true>>,
  Expect<Equal<"maybe.deep.x" extends Paths ? true : false, true>>,
  Expect<Equal<"user.emails.0.adress" extends Paths ? true : false, false>>,
  Expect<Equal<"nope" extends Paths ? true : false, false>>,
  // A date is a leaf: nothing below it.
  Expect<Equal<"when.getTime" extends Paths ? true : false, false>>,
] = [true, true, true, true, true, true, true, true];

export const valueChecks: [
  Expect<Equal<PathValue<User, "name">, string>>,
  Expect<Equal<PathValue<User, "user.emails.0.address">, string>>,
  Expect<Equal<PathValue<User, "user.emails.0.primary">, boolean | undefined>>,
  Expect<Equal<PathValue<User, "user.emails">, { address: string; primary?: boolean }[]>>,
  Expect<Equal<PathValue<User, "user.tags.1">, string>>,
  Expect<Equal<PathValue<User, "maybe.deep.x">, number | undefined>>,
  Expect<Equal<PathValue<User, "when">, Date>>,
] = [true, true, true, true, true, true, true];

export function fromDefaultValues(): void {
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: { email: "", age: 0, address: { city: "" }, tags: ["a"] },
  });
  const email: FieldApi<string> = form.field("email");
  const city: FieldApi<string> = form.field("address.city");
  const firstTag: FieldApi<string> = form.field("tags.0");
  const age: number = form.getValues("age");
  // @ts-expect-error a misspelt path is a type error
  form.field("emial");
  // @ts-expect-error a value of the wrong type
  form.setValue("age", "forty");
  // @ts-expect-error a number field is not a string field
  const wrong: FieldApi<string> = form.field("age");
  form.setValue("age", (previous) => previous + 1);
  void [email, city, firstTag, age, wrong];
}

export function withPartialDefaults(): void {
  const form = useForm<User>({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: { name: "Ada", user: { tags: [] } },
  });
  const address: FieldApi<string> = form.field("user.emails.0.address");
  const primary: FieldApi<boolean | undefined> = form.field("user.emails.0.primary");
  const deep: FieldApi<number | undefined> = form.field("maybe.deep.x");
  // @ts-expect-error not a path of User
  form.field("user.emails.0.adress");
  void [address, primary, deep];
}

export function withSchema(): void {
  const schema = z.object({
    name: z.string().min(1),
    age: z.string().transform((value) => Number(value)),
    emails: z.array(z.object({ address: z.string() })),
  });
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    resolver: standardSchema(schema),
    defaultValues: { name: "", age: "" },
    onSubmit: (output, context) => {
      const checks: [
        Expect<Equal<typeof output, { name: string; age: number; emails: { address: string }[] }>>,
        Expect<
          Equal<typeof context.input, { name: string; age: string; emails: { address: string }[] }>
        >,
      ] = [true, true];
      return checks;
    },
  });
  const age: FieldApi<string> = form.field("age");
  const address: FieldApi<string> = form.field("emails.0.address");
  // @ts-expect-error the form holds the schema's input: age is a string there
  const ageNumber: FieldApi<number> = form.field("age");
  // @ts-expect-error not a field of the schema
  form.field("missing");
  void [age, address, ageNumber];
}

export function withAnyVendor(): void {
  // A schema from any vendor works: it only has to expose `~standard`.
  const other = {} as StandardSchemaV1<{ title: string }, { title: string; slug: string }>;
  const form = useForm({
    features: [fieldArrays, asyncValidation, submitErrors],
    resolver: standardSchema(other),
    onSubmit: (output) => {
      const slug: string = output.slug;
      return slug;
    },
  });
  const title: FieldApi<string> = form.field("title");
  void title;
}

export function arrays(): void {
  const form = useForm<User>({
    features: [fieldArrays, asyncValidation, submitErrors],
    defaultValues: {},
  });
  const emails: FieldArrayApi<{ address: string; primary?: boolean }> = form.fields("user.emails");
  const tags: FieldArrayApi<string> = form.fields("user.tags");
  emails.append({ address: "a@b" });
  emails.insert(0, { address: "a@b", primary: true }, { address: "c@d" });
  // @ts-expect-error an item without its required property
  emails.append({ primary: true });
  // @ts-expect-error a string field is not an array
  form.fields("name");
  // @ts-expect-error not a path
  form.fields("user.emial");
  const row: RowApi<{ address: string; primary?: boolean }> = emails.at(0);
  const rowAddress: FieldApi<string> = row.field("address");
  const rowSelf: FieldApi<{ address: string; primary?: boolean }> = row.field();
  // @ts-expect-error not a path of the item
  row.field("nope");
  const tagRow: FieldApi<string> = tags.at(0).field();
  const mapped: () => string[] = emails.each(
    (item, index) => `${index() + 1}:${item.field("address").value()}`,
  );
  void [rowAddress, rowSelf, tagRow, mapped];
}

export async function submit(form: FormApi<User>): Promise<void> {
  const result = await form.handleSubmit();
  if (result.ok) {
    const data: User = result.data;
    void data;
  } else {
    const reason: "invalid" | "error" | "busy" | "disabled" | "canceled" = result.reason;
    void reason;
  }
}

/** The features are typed: `fields` exists only with the arrays feature, and the old `schema` option is gone. */
export function features(): void {
  const plain = useForm({ defaultValues: { tags: [] as string[] } });
  // @ts-expect-error without the arrays feature there is no `fields`
  void plain.fields("tags");
  const withArrays = useForm({ features: [fieldArrays], defaultValues: { tags: [] as string[] } });
  void withArrays.fields("tags").length();
  // @ts-expect-error the schema option was replaced by `resolver`
  void useForm({ schema: z.object({}), defaultValues: {} });
  const timed = useForm({ features: [asyncValidation], debounceMs: 50, defaultValues: {} });
  void timed;
}
