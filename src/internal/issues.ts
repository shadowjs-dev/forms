/**
 * Turning what validators, schemas and servers return into {@link FieldIssue}s, and issue paths
 * into field paths.
 * @packageDocumentation
 */
import { FormPathError, formatPath, parsePath, type Segment } from "../path";
import type { StandardSchemaV1Issue } from "../standard-schema";
import type { FieldIssue, IssueInput, ServerIssue } from "../types";

/**
 * Problems with a path that is not a field (the form as a whole).
 * @internal
 */
export const ROOT_PATH = "";

/**
 * The message of a feature the form needs but was not given: it names the feature and its entry point.
 * @internal
 */
export function missingFeature(
  what: string,
  feature: "asyncValidation" | "submitErrors" | "dates",
  entry: string,
): string {
  return `[forms] ${what} needs features: [${feature}] (@shadow-js/forms/${entry})`;
}

/** True for a plain `{ message }` issue object. */
function isIssueObject(value: unknown): value is Exclude<IssueInput, string> {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "message") === "string"
  );
}

/**
 * Normalizes what a validator returned into issues. Nothing, `null`, `undefined` and the empty
 * string mean "valid"; a string is a message; an object has a `message`; a list holds any of those.
 *
 * @param input A validator result.
 * @param type The `type` given to issues that do not name one.
 * @returns The issues, possibly none.
 * @throws TypeError for a value that is none of the above (for example `true`).
 * @since 1.0.0
 * @internal
 */
export function toIssues(input: unknown, type: string): FieldIssue[] {
  if (input === undefined || input === null || input === "") return [];
  if (typeof input === "string") return [{ message: input, type }];
  if (Array.isArray(input)) {
    const out: FieldIssue[] = [];
    for (const item of input) out.push(...toIssues(item, type));
    return out;
  }
  if (isIssueObject(input)) {
    if (input.message === "") return [];
    return [
      {
        message: input.message,
        type: input.type ?? type,
        ...(input.params === undefined ? {} : { params: input.params }),
      },
    ];
  }
  throw new TypeError(
    "[forms] a validator must return a message, an issue object, a list of them, or nothing",
  );
}

/**
 * The issue a thrown or rejected validator becomes: the form keeps working and shows why.
 * @internal
 */
export function failureIssue(error: unknown): FieldIssue {
  const message =
    error instanceof Error && error.message !== ""
      ? error.message
      : "This value could not be checked.";
  return { message, type: "validate", params: { error } };
}

/**
 * One path step of a Standard Schema or server issue, as a segment.
 * @internal
 */
export function segmentOf(step: PropertyKey | { readonly key: PropertyKey }): Segment {
  const key = typeof step === "object" ? step.key : step;
  if (typeof key === "number") return key;
  if (typeof key === "symbol") return key.description ?? "symbol";
  return key;
}

/**
 * A path as segments; `undefined` when it cannot be a field path (reserved or odd keys).
 * @internal
 */
export function pathSegments(
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): Segment[] | undefined {
  if (path === undefined || path.length === 0) return [];
  const out: Segment[] = [];
  for (const step of path) out.push(segmentOf(step));
  // The grammar decides what names a field: an empty or reserved key, a key with `.`, `[`, `]` or a
  // control character, and an index that is not a non-negative safe integer all name nothing, so
  // the problem belongs to the form as a whole. Refused here, not thrown: a server's issues must
  // not break the submit that reports them.
  try {
    formatPath(out);
  } catch (error) {
    if (error instanceof FormPathError) return undefined;
    throw error;
  }
  return out;
}

/**
 * A path as canonical text, or the root path for no segments.
 * @internal
 */
export function pathText(segments: readonly Segment[]): string {
  return segments.length === 0 ? ROOT_PATH : formatPath(segments);
}

/**
 * The segments of a path text (`""` is the root).
 * @internal
 */
export function textSegments(path: string): Segment[] {
  return path === ROOT_PATH ? [] : [...parsePath(path)];
}

/**
 * One server or schema problem with its path as text: what `extractIssues` and `parseFormData`
 * return, and what `issuesToErrors` groups.
 * @example
 * ```ts
 * import { type FlatIssue, issuesToErrors } from "@shadow-js/forms/server";
 *
 * const issues: FlatIssue[] = [
 *   { path: "email", message: "Taken" },
 *   { path: "", message: "Try again later", type: "server" },
 * ];
 * console.log(issuesToErrors(issues));
 * ```
 * @since 1.0.0
 */
export interface FlatIssue {
  /**
   * The field path as canonical text (`"tags.0.label"`), or `""` for the form as a whole (also
   * used when the original path cannot name a field).
   */
  readonly path: string;
  /** The message to show. */
  readonly message: string;
  /**
   * The kind of problem, when the source named one (a `{ message, type }` entry of a map).
   * Optional: issues read from a Standard Schema or server issue list have none.
   */
  readonly type?: string | undefined;
}

/**
 * Flattens Standard Schema issues (and the serialized issues a server sends) into path text and
 * message. Issues whose path cannot be a field path land on the root.
 *
 * @param issues The issues.
 * @returns One entry per issue, in order.
 * @since 1.0.0
 * @internal
 */
export function flattenIssues(
  issues: ReadonlyArray<StandardSchemaV1Issue | ServerIssue>,
): FlatIssue[] {
  return issues.map((issue) => {
    const segments = pathSegments(issue.path);
    return {
      path: segments === undefined ? ROOT_PATH : pathText(segments),
      message: issue.message,
    };
  });
}
