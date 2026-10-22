// Type tests for the full preset: a minimal form has no `fields`, `features: [fieldArrays]` types
// `fields`, and `features: full` types `fields` and still infers the input from `defaultValues`.
// Misuse is rejected by `@ts-expect-error` (an unused directive is itself an error). Each scenario is
// a function so that its variables are inferred (the module is compiled with isolatedDeclarations).
import { fieldArrays } from "../src/arrays";
import { full, useForm } from "../src/full";
import type { Equal, Expect } from "./support";

/** A form without the `arrays` feature has no `fields`. */
export function minimalHasNoFields(): void {
  const form = useForm({ defaultValues: { tags: ["a"] } });
  // @ts-expect-error without the arrays feature there is no `fields`
  form.fields("tags");
}

/** `features: [fieldArrays]` types `fields`: rows take the item's shape, and only real paths are accepted. */
export function arraysFeatureTypesFields(): void {
  const form = useForm({ features: [fieldArrays], defaultValues: { tags: [{ label: "news" }] } });
  form.fields("tags").append({ label: "sports" });
  // @ts-expect-error a row must have the item's shape
  form.fields("tags").append({ title: "sports" });
  // @ts-expect-error the path must exist in the values
  form.fields("missing");
}

/** `features: full` types `fields`: rows and paths come from the values, and the features are the preset's. */
export function fullPresetRows(): void {
  const form = useForm({
    features: full,
    defaultValues: { email: "", tags: [{ label: "news" }] },
  });
  form.fields("tags").append({ label: "sports" });
  // @ts-expect-error the row shape comes from `defaultValues`
  form.fields("tags").append({ title: "sports" });
  // @ts-expect-error not a path of the values
  form.fields("missing");
  // @ts-expect-error `email` is a field, not an array
  form.fields("email");
}

/** `features: full` still infers the input type from `defaultValues`: the reads are typed by it. */
export function fullPresetInference(): readonly [true, true, true] {
  const form = useForm({
    features: full,
    defaultValues: { email: "", tags: [{ label: "news" }] },
  });
  const emailValue = form.getValues("email");
  const rowCount = form.fields("tags").length();
  const values = form.getValues();
  const checks: [
    Expect<Equal<typeof emailValue, string>>,
    Expect<Equal<typeof rowCount, number>>,
    Expect<Equal<typeof values, { email: string; tags: { label: string }[] }>>,
  ] = [true, true, true];
  return checks;
}

declare function isTaken(name: string): Promise<boolean>;

// The README's "Full preset" example, kept here so the compiler checks it.
function _readmePlaylistForm() {
  const form = useForm({ features: full, defaultValues: { name: "", songs: [{ title: "" }] } });
  form.field("name", {
    validate: {
      debounceMs: 300,
      validate: async (name) => ((await isTaken(name)) ? "Name taken" : undefined),
    },
  });
  const addSong = (): void => form.fields("songs").append({ title: "" });
  return { form, addSong };
}
