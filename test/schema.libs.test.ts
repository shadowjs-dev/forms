import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useForm } from "../src/index";
import { formDataToValues, issuesToErrors, parseFormData } from "../src/server";
import { type StandardSchemaV1, standardSchema } from "../src/standard-schema";
import { makeForm } from "./support/forms";

/** A native post built from name/value pairs, as a browser builds it. */
function postOf(pairs: ReadonlyArray<readonly [string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of pairs) data.append(name, value);
  return data;
}

describe("Zod 4 through Standard Schema", () => {
  it("[FRM-960] z.coerce turns the text of a number input into a number: the output type is checked and onSubmit gets the output", async () => {
    const signup = z.object({ age: z.coerce.number().int().min(18), email: z.email() });
    const result = await parseFormData(
      signup,
      postOf([
        ["age", "41"],
        ["email", "ada@example.com"],
      ]),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(typeof result.data.age).toBe("number");
    expect(result.data.age).toBe(41);
    expect(result.values).toEqual({ age: "41", email: "ada@example.com" });

    let received: { age: number; email: string } | undefined;
    const form = makeForm<{ age: unknown; email: string }, { age: number; email: string }>({
      resolver: standardSchema(signup),
      defaultValues: { age: "", email: "" },
      onSubmit: (data) => {
        received = data;
      },
    });
    form.setValues({ age: "41", email: "ada@example.com" });
    const submitted = await form.handleSubmit();
    expect(submitted.ok).toBe(true);
    expect(received).toEqual({ age: 41, email: "ada@example.com" });
    expect(typeof received?.age).toBe("number");
  });

  it("[FRM-961] an async refinement keeps the form invalid until it answers, then shows its message on the field", async () => {
    const handles = z.object({
      handle: z.string().refine(async (value) => value !== "ada", { message: "Taken" }),
    });
    const form = makeForm<{ handle: string }>({
      resolver: standardSchema(handles),
      defaultValues: { handle: "" },
    });
    form.setValue("handle", "ada");
    // Problems are shown once the field is checked (validateOn is "touched" by default).
    const pending = form.trigger("handle");
    expect(form.isValid()).toBe(false);
    expect(await pending).toBe(false);
    expect(form.field("handle").error()).toBe("Taken");
    form.setValue("handle", "grace");
    expect(await form.trigger("handle")).toBe(true);
    expect(form.field("handle").error()).toBeUndefined();
    const result = await parseFormData(handles, postOf([["handle", "ada"]]));
    expect(result).toMatchObject({
      success: false,
      issues: [{ path: "handle", message: "Taken" }],
    });
  });

  it("[FRM-962] without the asyncValidation feature an async refinement is a form problem that names the feature, never a silent pass", async () => {
    const handles = z.object({
      handle: z.string().refine(async (value) => value !== "ada", { message: "Taken" }),
    });
    const form = useForm<{ handle: string }>({
      features: [],
      resolver: standardSchema(handles),
      defaultValues: { handle: "" },
    });
    form.setValue("handle", "ada");
    await form.trigger();
    const messages = form.formErrors().map((issue) => issue.message);
    expect(messages.some((message) => message.includes("asyncValidation"))).toBe(true);
    expect(form.field("handle").error()).toBeUndefined();
  });
});

describe("Valibot and ArkType through Standard Schema", () => {
  it("[FRM-963] Valibot transform gives the output type; ArkType morph parses a numeric string to a number", async () => {
    const valibotSignup = v.object({
      age: v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(18)),
    });
    const parsed = await parseFormData(valibotSignup, postOf([["age", "41"]]));
    expect(parsed).toMatchObject({ success: true, data: { age: 41 } });
    if (parsed.success) expect(typeof parsed.data.age).toBe("number");

    const arkSignup = type({ age: "string.numeric.parse" });
    const morphed = await parseFormData(arkSignup, postOf([["age", "41"]]));
    expect(morphed).toMatchObject({ success: true, data: { age: 41 } });
    if (morphed.success) expect(typeof morphed.data.age).toBe("number");

    const form = makeForm<{ age: string }, { age: number }>({
      resolver: standardSchema(arkSignup),
      defaultValues: { age: "" },
      onSubmit: () => undefined,
    });
    form.setValue("age", "40");
    expect((await form.handleSubmit()).ok).toBe(true);
  });

  it("[FRM-964] nested and array issue paths map to the same field paths in Zod, Valibot and ArkType", async () => {
    const pairs: Array<[string, string]> = [
      ["user.emails.0.address", "ada@example.com"],
      ["user.emails.1.address", "not-an-email"],
    ];
    const zodUser = z.object({
      user: z.object({ emails: z.array(z.object({ address: z.email() })) }),
    });
    const valibotUser = v.object({
      user: v.object({
        emails: v.array(v.object({ address: v.pipe(v.string(), v.email()) })),
      }),
    });
    const arkUser = type({ user: { emails: type({ address: "string.email" }).array() } });
    const schemas = [zodUser, valibotUser, arkUser];
    for (const schema of schemas) {
      const result = await parseFormData(schema, postOf(pairs));
      expect(result.success, "the bad address is refused").toBe(false);
      if (result.success) continue;
      expect(result.issues.map((issue) => issue.path)).toContain("user.emails.1.address");
      expect(result.errors["user.emails.1.address"]?.length).toBeGreaterThan(0);
      expect(result.errors["user.emails.0.address"]).toBeUndefined();
      expect(issuesToErrors(result.issues)).toEqual(result.errors);
    }
  });

  it("[FRM-965] a union that fails at a field names that field; a union of the whole form lands on the form as a whole", async () => {
    const zodChoice = z.object({ choice: z.union([z.number(), z.boolean()]) });
    const zodWhole = z.union([z.object({ choice: z.number() }), z.object({ choice: z.boolean() })]);
    const valibotChoice = v.object({ choice: v.union([v.number(), v.boolean()]) });
    const valibotWhole = v.union([
      v.object({ choice: v.number() }),
      v.object({ choice: v.boolean() }),
    ]);
    const arkChoice = type({ choice: "number|boolean" });
    const arkWhole = type({ choice: "number" }).or({ choice: "boolean" });

    const field = postOf([["choice", "maybe"]]);
    for (const schema of [zodChoice, valibotChoice, arkChoice]) {
      const result = await parseFormData(schema, field);
      expect(result).toMatchObject({ success: false });
      if (result.success) continue;
      expect(result.errors["choice"]?.length).toBeGreaterThan(0);
      expect(result.errors[""]).toBeUndefined();
    }

    for (const schema of [zodWhole, valibotWhole, arkWhole]) {
      const result = await parseFormData(schema, field);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.errors[""]?.length).toBeGreaterThan(0);
      expect(result.issues.every((issue) => issue.path === "" || issue.path === "choice")).toBe(
        true,
      );
    }
    expect(formDataToValues(field)).toEqual({ choice: "maybe" });
  });

  it("[FRM-966] a schema that throws: a form shows the error as a form problem, and parseFormData passes the error through", async () => {
    const boom = new Error("schema exploded");
    const throwing: StandardSchemaV1<{ name: string }> = {
      "~standard": {
        version: 1,
        vendor: "broken",
        validate: (): never => {
          throw boom;
        },
      },
    };
    const form = makeForm<{ name: string }>({
      resolver: standardSchema(throwing),
      defaultValues: { name: "" },
    });
    form.setValue("name", "Ada");
    await form.trigger();
    expect(form.formErrors().map((issue) => issue.message)).toContain("schema exploded");

    await expect(parseFormData(throwing, postOf([["name", "Ada"]]))).rejects.toBe(boom);
  });
});
