/**
 * Puts problems that come from outside (a server response, `setError`) onto records.
 * @packageDocumentation
 */
import { batch } from "@shadow-js/core";
import type { FieldIssue } from "../types";
import { type FlatIssue, textSegments } from "./issues";
import { type PushedSource, pushIssues } from "./mutate";
import { type Core, type Rec, recOfSegments } from "./state";

/**
 * Shows each problem on the record its path names (the root for `""`), keeping problems of the
 * same source that are already there.
 *
 * @param core The form.
 * @param issues The problems, with paths as text.
 * @param source Which hand-set source they count as.
 * @returns The paths that received a problem.
 * @internal
 */
export function applyIssues(
  core: Core,
  issues: readonly FlatIssue[],
  source: PushedSource,
): string[] {
  const grouped = new Map<string, { rec: Rec; list: FieldIssue[] }>();
  const type = source === "server" ? "server" : "manual";
  for (const issue of issues) {
    const segments = textSegments(issue.path);
    const rec = recOfSegments(core, segments);
    let entry = grouped.get(rec.key);
    if (entry === undefined) {
      entry = { rec, list: [...rec[source]] };
      grouped.set(rec.key, entry);
    }
    entry.list.push({ message: issue.message, type: issue.type ?? type });
  }
  batch(() => {
    for (const { rec, list } of grouped.values()) pushIssues(core, rec, source, list);
  });
  return issues.map((issue) => issue.path);
}
