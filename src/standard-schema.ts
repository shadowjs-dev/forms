/**
 * The Standard Schema v1 interface (https://standardschema.dev), inlined so that Zod, Valibot,
 * ArkType, Effect Schema and any other conforming library work without a dependency on any of them,
 * and `standardSchema`, the resolver that runs a schema in a form. Subpath: `@shadow-js/forms/standard-schema`.
 * @packageDocumentation
 */
import { pathSegments } from "./internal/issues";
import { isPromiseLike } from "./internal/promise";
import type { Resolver, ResolverResult } from "./types";

export type { Resolver, ResolverContext, ResolverIssue, ResolverResult } from "./types";

/**
 * A schema that follows Standard Schema v1: an object (or function) with a `~standard` member
 * that can validate. Zod, Valibot, ArkType and Effect Schema schemas are all of this shape, so any
 * of them can be passed to {@link standardSchema} and `parseFormData`.
 * @example
 * ```ts
 * import type { StandardSchemaV1 } from "@shadow-js/forms/standard-schema";
 *
 * const email: StandardSchemaV1<string> = {
 *   "~standard": {
 *     version: 1,
 *     vendor: "example",
 *     validate: (value) =>
 *       typeof value === "string" && value.includes("@")
 *         ? { value }
 *         : { issues: [{ message: "Enter an email" }] },
 *   },
 * };
 * console.log(email["~standard"].vendor);
 * ```
 * @see {@link isStandardSchema}
 * @since 1.0.0
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties: version, vendor, the `validate` function and the types. */
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

/**
 * The `~standard` member of a {@link StandardSchemaV1}.
 * @example
 * ```ts
 * import type { StandardSchemaV1Props } from "@shadow-js/forms/standard-schema";
 *
 * const props: StandardSchemaV1Props<unknown, string> = {
 *   version: 1,
 *   vendor: "example",
 *   validate: (value) =>
 *     typeof value === "string" ? { value } : { issues: [{ message: "Expected text" }] },
 * };
 * console.log(props.validate("hello"));
 * ```
 * @since 1.0.0
 */
export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  /** The version of the interface: always `1` ({@link isStandardSchema} checks it). */
  readonly version: 1;
  /** The name of the library that made the schema, for example `"zod"` or `"valibot"`. */
  readonly vendor: string;
  /**
   * Checks a value. Answers with the output (after the schema's transforms) or with the problems,
   * synchronously or as a promise. A form runs a promised answer only with the `asyncValidation`
   * feature.
   */
  readonly validate: (
    value: unknown,
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  /** Inference-only: carries the input and output types. Never read at runtime. Optional. */
  readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

/**
 * The result of validating: the output value, or the problems found.
 * @example
 * ```ts
 * import type { StandardSchemaV1Result } from "@shadow-js/forms/standard-schema";
 *
 * const ok: StandardSchemaV1Result<number> = { value: 41 };
 * const failed: StandardSchemaV1Result<number> = {
 *   issues: [{ message: "Must be a number", path: ["age"] }],
 * };
 * console.log(ok, failed);
 * ```
 * @since 1.0.0
 */
export type StandardSchemaV1Result<Output> =
  | {
      /** The validated output. */
      readonly value: Output;
      /** Absent on success. */
      readonly issues?: undefined;
    }
  | {
      /** The problems found, at least one in practice. */
      readonly issues: readonly StandardSchemaV1Issue[];
    };

/**
 * One problem found by a schema.
 * @example
 * ```ts
 * import type { StandardSchemaV1Issue } from "@shadow-js/forms/standard-schema";
 *
 * const issue: StandardSchemaV1Issue = {
 *   message: "Too short",
 *   path: ["tags", 0, { key: "label" }],
 * };
 * console.log(issue.message);
 * ```
 * @since 1.0.0
 */
export interface StandardSchemaV1Issue {
  /** The message to show. */
  readonly message: string;
  /**
   * Where the problem is: keys and indexes from the root, each a key or a `{ key }` wrapper.
   * Absent or empty for a problem of the value as a whole. A form puts a problem whose path cannot
   * name a field (a reserved key such as `__proto__`, or an empty key) on the form as a whole.
   */
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * The input type of a schema: what the form holds (before transforms).
 * @example
 * ```ts
 * import type { InferInput, StandardSchemaV1 } from "@shadow-js/forms/standard-schema";
 *
 * declare const schema: StandardSchemaV1<{ age: string }, { age: number }>;
 * const draft: InferInput<typeof schema> = { age: "41" };
 * console.log(draft);
 * ```
 * @see {@link InferOutput}
 * @since 1.0.0
 */
export type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];

/**
 * The output type of a schema: what `onSubmit` receives (after transforms).
 * @example
 * ```ts
 * import type { InferOutput, StandardSchemaV1 } from "@shadow-js/forms/standard-schema";
 *
 * declare const schema: StandardSchemaV1<{ age: string }, { age: number }>;
 * const parsed: InferOutput<typeof schema> = { age: 41 };
 * console.log(parsed);
 * ```
 * @see {@link InferInput}
 * @since 1.0.0
 */
export type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];

/**
 * True when `value` has the Standard Schema v1 shape: an object or function whose `~standard`
 * member is an object with `version` `1` and a `validate` function. Use it to accept a schema from
 * any conforming library without depending on one.
 *
 * @param value Anything.
 * @returns Whether `value` is a Standard Schema. Never throws.
 * @example
 * ```ts
 * import { isStandardSchema } from "@shadow-js/forms/standard-schema";
 *
 * const schema = {
 *   "~standard": { version: 1, vendor: "example", validate: (value: unknown) => ({ value }) },
 * };
 * console.log(isStandardSchema(schema)); // true
 * console.log(isStandardSchema({ parse: () => undefined })); // false
 * ```
 * @since 1.0.0
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" && typeof value !== "function") return false;
  if (value === null) return false;
  const props: unknown = Reflect.get(value, "~standard");
  return (
    typeof props === "object" &&
    props !== null &&
    Reflect.get(props, "version") === 1 &&
    typeof Reflect.get(props, "validate") === "function"
  );
}

/**
 * The resolver of a Standard Schema: pass it as `resolver` to `useForm`. The schema's problems
 * land on the fields their paths name (a path that cannot name a field lands on the form as a
 * whole), and its output (after transforms) is what `onSubmit` receives. A schema that answers
 * with a promise needs the `asyncValidation` feature; without it the form shows a form-level
 * problem that names the feature.
 *
 * @param schema Any Standard Schema (Zod, Valibot, ArkType, Effect Schema, or one of your own).
 * @returns A resolver for `useForm({ resolver })`.
 * @throws TypeError when `schema` is not a Standard Schema (message starting with
 * `"[forms] standardSchema() needs a Standard Schema"`).
 * @example
 * ```ts
 * import { useForm } from "@shadow-js/forms";
 * import { type StandardSchemaV1, standardSchema } from "@shadow-js/forms/standard-schema";
 *
 * const signup: StandardSchemaV1<{ email: string }> = {
 *   "~standard": {
 *     version: 1,
 *     vendor: "example",
 *     validate: (value) => {
 *       const { email } = value as { email: string };
 *       return email.includes("@")
 *         ? { value: { email } }
 *         : { issues: [{ message: "Enter an email", path: ["email"] }] };
 *     },
 *   },
 * };
 *
 * const form = useForm({
 *   resolver: standardSchema(signup),
 *   defaultValues: { email: "" },
 *   onSubmit: (data) => console.log(data.email),
 * });
 * ```
 * @see {@link isStandardSchema}
 * @since 1.0.0
 */
export function standardSchema<Input extends object, Output = Input>(
  schema: StandardSchemaV1<Input, Output>,
): Resolver<Input, Output> {
  if (!isStandardSchema(schema)) {
    throw new TypeError(
      "[forms] standardSchema() needs a Standard Schema (an object with `~standard.validate`)",
    );
  }
  const answer = (done: StandardSchemaV1Result<Output>): ResolverResult<Output> => {
    if (done.issues !== undefined) {
      return {
        issues: done.issues.map((issue) => ({
          // A path that cannot name a field belongs to the form as a whole.
          path: pathSegments(issue.path) ?? [],
          message: issue.message,
        })),
      };
    }
    return { value: done.value };
  };
  return {
    validate(values) {
      const result = schema["~standard"].validate(values);
      return isPromiseLike(result) ? Promise.resolve(result).then(answer) : answer(result);
    },
  };
}
