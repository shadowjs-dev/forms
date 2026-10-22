/**
 * A tiny hand-written Standard Schema (not Zod): proves the library depends on the interface and
 * not on a vendor. It validates a flat record of string fields, reports issues with `{ key }` path
 * wrappers and numeric steps, and can answer asynchronously.
 */
import type { StandardSchemaV1 } from "../../src/index";

export interface Rule {
  readonly path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
  readonly check: (value: unknown) => string | undefined;
}

/** Walks `path` through `value` the way a schema library does. */
function read(value: unknown, path: Rule["path"]): unknown {
  let node = value;
  for (const step of path) {
    const key = typeof step === "object" ? step.key : step;
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

export function customSchema<Output = unknown>(
  rules: readonly Rule[],
  options: { asynchronous?: boolean; output?: (input: unknown) => Output } = {},
): StandardSchemaV1<Record<string, unknown>, Output> {
  const run = (input: unknown) => {
    const issues = rules.flatMap((rule) => {
      const message = rule.check(read(input, rule.path));
      return message === undefined ? [] : [{ message, path: rule.path }];
    });
    if (issues.length > 0) return { issues };
    const output = options.output === undefined ? (input as Output) : options.output(input);
    return { value: output };
  };
  return {
    "~standard": {
      version: 1,
      vendor: "custom",
      validate: (input) =>
        options.asynchronous === true ? Promise.resolve(run(input)) : run(input),
    },
  };
}

/** A promise settled by hand. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
