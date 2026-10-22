import { describe, expect, it } from "vitest";
import { isStandardSchema, type StandardSchemaV1 } from "../src/index";
import { standardSchema } from "../src/standard-schema";
import { makeForm, settle } from "./support/forms";

/**
 * Valibot and ArkType implement Standard Schema, so the form needs nothing library specific. They
 * are devDependencies of this package; a test fails with the reason when one is not installed.
 * The modules are used through a
 * loose function table so this file type-checks whether or not they are installed.
 */
const NOT_INSTALLED = (name: string): string =>
  `${name} is not installed (it is a devDependency of @shadow-js/forms: run \`npm install\`)`;

type Library = Readonly<Record<string, (...args: never[]) => unknown>>;

/** Imports a module by a name the bundler cannot see, so a missing package does not break the file. */
async function optional(name: string): Promise<Library | undefined> {
  try {
    return (await import(/* @vite-ignore */ name)) as Library;
  } catch (error) {
    if (
      error instanceof Error &&
      /Cannot find|Failed to (load|resolve)|not found/i.test(error.message)
    ) {
      return undefined;
    }
    throw error;
  }
}

const valibot = await optional("valibot");
const arktype = await optional("arktype");

/** Calls `library[name](...args)`. */
function call(library: Library, name: string, ...args: unknown[]): unknown {
  const fn = library[name];
  if (fn === undefined) throw new Error(`the library has no "${name}"`);
  return (fn as (...values: unknown[]) => unknown)(...args);
}

interface Values {
  email: string;
  age: string;
  tags: { label: string }[];
}

describe("Valibot", () => {
  it("[FRM-300] is a Standard Schema; issues reach fields, rows and the form; the output is the parsed value", async () => {
    if (valibot === undefined) throw new Error(NOT_INSTALLED("valibot"));
    const v = (name: string, ...args: unknown[]): unknown => call(valibot, name, ...args);
    const schema = v("object", {
      email: v("pipe", v("string"), v("email", "Enter an email")),
      age: v(
        "pipe",
        v("string"),
        v("transform", Number),
        v("number", "Age must be a number"),
        v("minValue", 18, "Adults only"),
      ),
      tags: v(
        "array",
        v("object", { label: v("pipe", v("string"), v("minLength", 2, "Label too short")) }),
      ),
    }) as StandardSchemaV1<Values, unknown>;
    expect(isStandardSchema(schema)).toBe(true);
    const seen: unknown[] = [];
    const form = makeForm<Values, unknown>({
      resolver: standardSchema(schema),
      defaultValues: { email: "nope", age: "5", tags: [{ label: "x" }] },
      onSubmit: (data) => void seen.push(data),
    });
    expect(form.isValid()).toBe(false);
    expect(await form.handleSubmit()).toMatchObject({ ok: false, reason: "invalid" });
    expect(form.errors()).toEqual({
      email: "Enter an email",
      age: "Adults only",
      "tags.0.label": "Label too short",
    });
    form.setValues({ email: "ada@example.com", age: "36", tags: [{ label: "ok" }] });
    expect(form.isValid()).toBe(true);
    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect(seen).toEqual([{ email: "ada@example.com", age: 36, tags: [{ label: "ok" }] }]);
  });

  it("[FRM-301] an asynchronous Valibot schema keeps the form invalid until it answers, then follows typing", async () => {
    if (valibot === undefined) throw new Error(NOT_INSTALLED("valibot"));
    const v = (name: string, ...args: unknown[]): unknown => call(valibot, name, ...args);
    const schema = v("objectAsync", {
      name: v(
        "pipeAsync",
        v("string"),
        v("checkAsync", async (value: string) => value !== "taken", "Name is taken"),
      ),
    }) as StandardSchemaV1<{ name: string }, unknown>;
    const form = makeForm<{ name: string }, unknown>({
      resolver: standardSchema(schema),
      defaultValues: { name: "taken" },
    });
    expect(form.isValid()).toBe(false);
    await settle(10);
    expect(await form.trigger()).toBe(false);
    expect(form.field("name").error()).toBe("Name is taken");
    form.field("name").setValue("free");
    await settle(10);
    expect(form.field("name").error()).toBeUndefined();
    expect(form.isValid()).toBe(true);
  });
});

describe("ArkType", () => {
  it("[FRM-302] is a Standard Schema; issues reach fields and rows; a morph gives the output type", async () => {
    if (arktype === undefined) throw new Error(NOT_INSTALLED("arktype"));
    const make = call(arktype, "type", { label: "string >= 2" }) as { array(): unknown };
    const schema = call(arktype, "type", {
      email: "string.email",
      age: "string.numeric.parse",
      tags: make.array(),
    }) as StandardSchemaV1<Values, unknown>;
    expect(isStandardSchema(schema)).toBe(true);
    const seen: unknown[] = [];
    const form = makeForm<Values, unknown>({
      resolver: standardSchema(schema),
      defaultValues: { email: "nope", age: "36", tags: [{ label: "x" }] },
      onSubmit: (data) => void seen.push(data),
    });
    expect(await form.handleSubmit()).toMatchObject({ ok: false, reason: "invalid" });
    const errors = form.errors();
    expect(Object.keys(errors).sort()).toEqual(["email", "tags.0.label"]);
    expect(errors["email"]).toContain("email");
    form.setValues({ email: "ada@example.com", tags: [{ label: "ok" }] });
    expect(await form.handleSubmit()).toMatchObject({ ok: true });
    expect(seen).toEqual([{ email: "ada@example.com", age: 36, tags: [{ label: "ok" }] }]);
  });
});
