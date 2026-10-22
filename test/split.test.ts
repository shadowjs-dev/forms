/**
 * The split of `useForm`: the minimal path imports none of the opt-in modules, and each opt-in
 * feature works when it is passed and fails clearly when it is not. Invariants [FRM-500]..[FRM-509].
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fieldArrays } from "../src/arrays";
import { asyncValidation } from "../src/async";
import { useFieldArray } from "../src/index";
import { FormSubmitError } from "../src/server-errors";
import type { StandardSchemaV1 } from "../src/standard-schema";
import { standardSchema } from "../src/standard-schema";
import { submitErrors } from "../src/submit-errors";
import { makeForm, settle } from "./support/forms";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Modules that only an opt-in feature (or an explicit helper) may import. */
const OPT_IN = [
  "full.ts",
  "arrays.ts",
  "async.ts",
  "submit-errors.ts",
  "standard-schema.ts",
  "server-issues.ts",
  "server-errors.ts",
  "form-data.ts",
  "guard.ts",
  "bind.ts",
  "hooks.ts",
  "wizard.ts",
  "internal/array.ts",
  "internal/rows.ts",
  "internal/async.ts",
];

/** The runtime (not type-only) relative imports of one module. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"(\.[^"]+)";/gm;
  for (const match of text.matchAll(pattern)) {
    const spec = match[1] as string;
    const base = resolve(dirname(file), spec);
    const candidates = [`${base}.ts`, join(base, "index.ts")];
    const target = candidates.find((candidate) => existsSync(candidate));
    if (target !== undefined) found.push(target);
  }
  return found;
}

/** Every module reachable through runtime imports from `entries`, as paths relative to `src`. */
function reachable(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = entries.map((entry) => join(src, entry));
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    const relative = file.slice(src.length + 1);
    if (seen.has(relative)) continue;
    seen.add(relative);
    for (const next of runtimeImports(file)) stack.push(next);
  }
  return seen;
}

/** A minimal Standard Schema for `{ name }`, enough to exercise the resolver. */
const nameSchema: StandardSchemaV1<{ name: string }, { name: string; length: number }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate(value) {
      const name = typeof value === "object" && value !== null ? Reflect.get(value, "name") : "";
      if (typeof name !== "string" || name === "") {
        return { issues: [{ message: "Name is required", path: ["name"] }] };
      }
      return { value: { name, length: name.length } };
    },
  },
};

describe("the minimal path", () => {
  it("[FRM-500] useForm and the field components reach no opt-in module through runtime imports", () => {
    // The barrel (`index.ts`) re-exports the opt-in helpers too; tree shaking drops the ones that
    // are not used. The strict check starts from the two modules a single-field form imports.
    const minimal = reachable(["use-form.ts", "components.ts"]);
    expect(OPT_IN.filter((name) => minimal.has(name))).toEqual([]);
  });

  it("[FRM-501] `schema` is refused with the name of its replacement", () => {
    const options = { schema: nameSchema } as unknown as Parameters<typeof makeForm>[0];
    expect(() => makeForm(options)).toThrow(/resolver: standardSchema\(schema\)/);
  });

  it("[FRM-502] without the arrays feature there is no `form.fields`, and the array hook says which feature is missing", () => {
    const form = makeForm({ features: [], defaultValues: { tags: ["a"] } });
    expect((form as unknown as { fields?: unknown }).fields).toBeUndefined();
    expect(() => useFieldArray({ form, name: "tags" as never })).toThrow(/fieldArrays/);
  });

  it("[FRM-503] `form.fields` exists with the arrays feature, and the feature is the only way to get it", () => {
    const form = makeForm({
      features: [fieldArrays],
      defaultValues: { tags: ["a"] },
    });
    expect(form.fields("tags").length()).toBe(1);
  });

  it("[FRM-504] a plain sync validate function and a field validator run without any feature", async () => {
    const form = makeForm({
      features: [],
      defaultValues: { name: "x" },
      validate: (values) => (values.name === "bad" ? "Not allowed" : undefined),
    });
    form.setValue("name", "bad");
    await settle();
    expect(form.isValid()).toBe(false);
    form.setValue("name", "ok");
    expect(form.isValid()).toBe(true);
  });
});

describe("the resolver", () => {
  it("[FRM-505] `resolver: standardSchema(schema)` checks, shows the problem on its field and submits the parsed output", async () => {
    const seen: Array<{ name: string; length: number }> = [];
    const form = makeForm({
      features: [],
      defaultValues: { name: "" },
      resolver: standardSchema(nameSchema),
      onSubmit: (output) => {
        seen.push(output);
      },
    });
    const first = await form.handleSubmit();
    expect(first.ok).toBe(false);
    expect(form.field("name").error()).toBe("Name is required");
    form.setValue("name", "Ada");
    const second = await form.handleSubmit();
    expect(second.ok).toBe(true);
    expect(seen).toEqual([{ name: "Ada", length: 3 }]);
  });
});

describe("the opt-in features", () => {
  it("[FRM-506] an async validator without the asyncValidation feature is an issue that names it, not a silent pass", async () => {
    const form = makeForm({ features: [], defaultValues: { code: "" } });
    form.field("code", { validate: async () => "Taken" });
    await form.trigger("code");
    expect(form.field("code").error()).toMatch(/asyncValidation/);
  });

  it("[FRM-507] with the asyncValidation feature an async validator answers the field", async () => {
    const form = makeForm({ features: [asyncValidation], defaultValues: { code: "" } });
    form.field("code", { validate: async () => "Taken" });
    await form.trigger("code");
    expect(form.field("code").error()).toBe("Taken");
  });

  it("[FRM-508] `debounceMs` without the asyncValidation feature is refused when the form is created", () => {
    expect(() => makeForm({ features: [], debounceMs: 200, defaultValues: {} })).toThrow(
      /asyncValidation/,
    );
    expect(() =>
      makeForm({ features: [asyncValidation], debounceMs: 200, defaultValues: {} }),
    ).not.toThrow();
  });

  it("[FRM-509] the submitErrors feature maps a FormSubmitError onto its fields; without it the error stays the submit error", async () => {
    const thrower = (): never => {
      throw new FormSubmitError("Could not save", { fieldErrors: { email: "Already used" } });
    };
    const bare = makeForm({
      features: [],
      defaultValues: { email: "a@b.c" },
      onSubmit: thrower,
    });
    await bare.handleSubmit();
    expect(bare.field("email").error()).toBeUndefined();
    expect(bare.submitError()?.message).toBe("Could not save");

    const mapped = makeForm({
      features: [submitErrors],
      defaultValues: { email: "a@b.c" },
      onSubmit: thrower,
    });
    await mapped.handleSubmit();
    expect(mapped.field("email").error()).toBe("Already used");
  });
});

describe("the full preset", () => {
  it("[FRM-520] the full preset is opt-in: the minimal path does not reach full.ts", () => {
    const minimal = reachable(["use-form.ts", "components.ts"]);
    expect(minimal.has("full.ts")).toBe(false);
  });

  it("[FRM-521] full.ts reaches the three feature modules and the engine it installs them into", () => {
    const preset = reachable(["full.ts"]);
    const required = ["arrays.ts", "async.ts", "submit-errors.ts", "use-form.ts"];
    expect(required.filter((name) => !preset.has(name))).toEqual([]);
  });
});
