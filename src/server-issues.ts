/**
 * Reading problems out of whatever a server sends: Standard Schema issues, the `issues` of a
 * `@shadow-js/dusk` validation error (also under `data`), a `fieldErrors` map, or a plain map of
 * path to message(s). Pure functions with no reactive imports, so server code can use them too.
 * @packageDocumentation
 */
import { type FlatIssue, flattenIssues, ROOT_PATH } from "./internal/issues";
import { parsePath } from "./path";
import type { IssueInput, ServerIssue } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path given as text (a map key) in canonical form; text that is not a path lands on the root. */
function textPath(path: string): string {
  if (path === ROOT_PATH) return ROOT_PATH;
  try {
    return parsePath(path).join(".");
  } catch (error) {
    if (error instanceof TypeError) return ROOT_PATH;
    throw error;
  }
}

function isIssueArray(value: unknown): value is readonly ServerIssue[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isRecord(item) && typeof item["message"] === "string")
  );
}

function fromMap(map: Record<string, unknown>): FlatIssue[] | undefined {
  const out: FlatIssue[] = [];
  for (const [path, value] of Object.entries(map)) {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (typeof item === "string") {
        out.push({ path: textPath(path), message: item });
      } else if (isRecord(item) && typeof item["message"] === "string") {
        out.push({
          path: textPath(path),
          message: item["message"],
          type: typeof item["type"] === "string" ? item["type"] : undefined,
        });
      } else {
        return undefined;
      }
    }
  }
  return out;
}

/**
 * Finds the field problems in `source`: a thrown error, a response body, an issue list or a map.
 * Use it in server code to turn what a validation step produced into data a response can carry,
 * or on the client before `applyServerErrors`.
 *
 * Recognized, in this order: a list of `{ message, path? }`; an object or error with `issues` (a
 * `ValidationError` from `@shadow-js/dusk`, or a failed Standard Schema result); an object or
 * error whose `data.issues` is such a list (what a server function throws on the client); an
 * object or error with a `fieldErrors` map; and, for plain objects only, a map of path to
 * message(s). A map value is a message, a `{ message, type? }` object, or a list of them.
 *
 * Paths come back as canonical text (`"tags.0.label"`). A path that cannot name a field (a reserved
 * key such as `__proto__`, an empty key, or map text that does not parse as a path) becomes `""`,
 * the form as a whole. The `type` of a map entry is kept; issues from a list carry none.
 *
 * @param source A thrown value, a response body, an issue list or a map.
 * @returns One entry per problem, in order (an empty list for an empty `issues` list), or
 * `undefined` when `source` has none of the shapes above: `null`, a string, an `Error` without
 * issues, or a map with a value that is not a message.
 * @example
 * ```ts
 * import { extractIssues } from "@shadow-js/forms/server";
 *
 * const issues = extractIssues({ issues: [{ message: "Taken", path: ["email"] }] });
 * // [{ path: "email", message: "Taken" }]
 * const fromMap = extractIssues({ fieldErrors: { "tags[0]": "Too short" } });
 * // [{ path: "tags.0", message: "Too short" }]
 * console.log(issues, fromMap);
 * ```
 * @see {@link issuesToErrors}
 * @since 1.0.0
 */
export function extractIssues(source: unknown): FlatIssue[] | undefined {
  if (isIssueArray(source)) return flattenIssues(source);
  // An Error is a record too, so its own `issues` and `fieldErrors` count.
  if (!isRecord(source)) return undefined;
  if (isIssueArray(source["issues"])) return flattenIssues(source["issues"]);
  const data = source["data"];
  if (isRecord(data) && isIssueArray(data["issues"])) return flattenIssues(data["issues"]);
  const fieldErrors = source["fieldErrors"];
  if (isRecord(fieldErrors)) return fromMap(fieldErrors);
  if (source instanceof Error) return undefined;
  return fromMap(source);
}

/**
 * Groups problems by path, in the shape the `initialErrors` option of `useForm` and JSON
 * responses use. Each message becomes a `{ message }` object, with `type` when the issue has one.
 *
 * @param issues Problems with paths as text, as {@link extractIssues} returns them.
 * @returns Path to the messages for it, in order (`""` holds the form-level ones). Paths with no
 * problem are absent.
 * @example
 * ```ts
 * import { extractIssues, issuesToErrors } from "@shadow-js/forms/server";
 *
 * const issues = extractIssues([{ message: "Taken", path: ["email"] }]) ?? [];
 * const errors = issuesToErrors(issues); // { email: [{ message: "Taken" }] }
 * const body = JSON.stringify({ errors });
 * console.log(body);
 * ```
 * @see {@link extractIssues}
 * @since 1.0.0
 */
export function issuesToErrors(
  issues: ReadonlyArray<FlatIssue>,
): Record<string, Exclude<IssueInput, string>[]> {
  const out: Record<string, Exclude<IssueInput, string>[]> = {};
  for (const issue of issues) {
    const list = out[issue.path] ?? [];
    list.push(
      issue.type === undefined
        ? { message: issue.message }
        : { message: issue.message, type: issue.type },
    );
    out[issue.path] = list;
  }
  return out;
}

export type { FlatIssue };
