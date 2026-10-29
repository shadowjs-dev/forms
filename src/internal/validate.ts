/**
 * The validation engine: a resolver / form-level pass over all values, field validators, and the
 * rules that decide when a problem becomes visible.
 *
 * Two layers: the *truth* (what is wrong right now, always current) and what is *shown* (updated
 * only when `validateOn` / `reValidateOn` say so). `isValid()` reads the truth; fields read what
 * is shown.
 *
 * Synchronous answers are the minimal path. Promises, debounce timers and cancellation belong to the
 * `asyncValidation` feature (`internal/async.ts`), which the form reaches through `core.async`; a
 * promise without that feature is refused as an issue, so a missing feature is visible.
 *
 * @packageDocumentation
 */
import { batch, snapshot, untrack } from "@shadow-js/core";
import { formatPath, getIn, matchesPattern, type Segment, startsWith } from "../path";
import type {
  FieldIssue,
  FormValidateResult,
  ResolverResult,
  ValidationTrigger,
  ValidatorSpec,
} from "../types";
import type { AsyncPlug } from "./async";
import { failureIssue, missingFeature, ROOT_PATH, textSegments, toIssues } from "./issues";
import { isPromiseLike } from "./promise";
import { isRecord } from "./shape";
import {
  type Core,
  type ExcludedIssue,
  indexPathOf,
  issuesEqual,
  isUnder,
  keyOfSegments,
  NO_ISSUES,
  type Part,
  type Rec,
  recOf,
  recOfSegments,
  recomputeTruth,
  setShown,
  walk,
} from "./state";

/**
 * What starts a pass. `"init"` never shows anything.
 * @internal
 */
export interface Request {
  readonly trigger: ValidationTrigger | "init";
  /** Paths whose problems may become visible. `undefined`: every path. */
  readonly prefixes?: readonly (readonly Segment[])[] | undefined;
}

/**
 * A problem found by the resolver or the form validator, before it is mapped to a field.
 * @internal
 */
export interface RawIssue {
  readonly segments: Segment[];
  readonly message: string;
  readonly type: string;
  /** True for a problem the resolver reported (the output cannot be produced while one exists). */
  readonly resolver: boolean;
}

/**
 * The outcome of the resolver and the form validator for one pass.
 * @internal
 */
export interface GlobalOutcome {
  readonly issues: RawIssue[];
  readonly output?: { readonly value: unknown } | undefined;
}

/**
 * An outcome that a promise will deliver. Only the async feature ever holds one.
 * @internal
 */
export type Pending = GlobalOutcome | PromiseLike<GlobalOutcome>;

/** The problems of one record, with the path parts needed to create it. */
interface Mapped {
  readonly parts: Part[];
  readonly issues: FieldIssue[];
}

/**
 * The message of a check that answers with a promise when the async feature is absent.
 * @internal
 */
export const NEEDS_ASYNC: string = missingFeature(
  __DEV__ ? "async validation" : "FORMS_NEED_2",
  "asyncValidation",
  "async",
);

/**
 * The values a pass validates and a submit sends: a plain copy with disabled fields left out
 * (array items are set to `undefined`, so indices stay aligned).
 * @internal
 */
export function effectiveValues(core: Core): object {
  const copy = snapshot(core.values);
  if (!core.opts.excludeDisabled || core.disabledKeys.size === 0) return copy;
  for (const key of core.disabledKeys) {
    const rec = core.recs.get(key);
    if (rec === undefined) continue;
    const segments = indexPathOf(core, rec);
    if (segments === undefined || segments.length === 0) continue;
    const parent = getIn(copy, segments.slice(0, -1));
    if (typeof parent !== "object" || parent === null) continue;
    const last = String(segments[segments.length - 1]);
    if (Array.isArray(parent)) parent[Number(last)] = undefined;
    else if (isRecord(parent)) delete parent[last];
  }
  return copy;
}

// ---------------------------------------------------------------------------------------------
// The global pass: resolver and form validator
// ---------------------------------------------------------------------------------------------

function asFormIssues(result: FormValidateResult): RawIssue[] {
  if (result === undefined || result === null || result === "") return [];
  if (typeof result === "string") {
    return [{ segments: [], message: result, type: "validate", resolver: false }];
  }
  const out: RawIssue[] = [];
  if (Array.isArray(result)) {
    for (const item of result) {
      let segments: Segment[] = [];
      if (typeof item.path === "string") {
        segments = textSegments(item.path);
      } else if (item.path !== undefined) {
        segments = [...item.path];
      }
      out.push({ segments, message: item.message, type: item.type ?? "validate", resolver: false });
    }
    return out;
  }
  for (const [path, value] of Object.entries(result)) {
    const segments = textSegments(path);
    for (const issue of toIssues(value, "validate")) {
      out.push({ segments, message: issue.message, type: issue.type, resolver: false });
    }
  }
  return out;
}

/** Runs `fn`; a throw becomes an outcome with one root issue (a broken validator must not break the form). */
function guarded<T>(fn: () => T, onThrow: (error: unknown) => T): T {
  try {
    return fn();
  } catch (error) {
    return onThrow(error);
  }
}

function outcomeOfError(error: unknown): GlobalOutcome {
  const issue = failureIssue(error);
  return {
    issues: [{ segments: [], message: issue.message, type: issue.type, resolver: false }],
  };
}

/** The check's problems (or its output), from what the resolver answered. */
function outcomeOfResult(done: ResolverResult<unknown>): GlobalOutcome {
  if (done.issues !== undefined) {
    return {
      issues: done.issues.map((issue) => ({
        // An empty path is the form as a whole.
        segments: [...issue.path],
        message: issue.message,
        type: issue.type ?? "schema",
        resolver: true,
      })),
    };
  }
  return { issues: [], output: { value: done.value } };
}

/**
 * One check of the global pass, turned into its outcome. A throw becomes a problem, and so does a
 * promised answer that is rejected or malformed when it settles (it must not end as a rejection).
 */
function checkOf<A>(
  call: () => A | PromiseLike<A>,
  convert: (answer: A) => GlobalOutcome,
): Pending {
  return guarded<Pending>(() => {
    const answer = call();
    if (!isPromiseLike(answer)) return convert(answer as A);
    return Promise.resolve(answer).then(
      (done) => guarded(() => convert(done as A), outcomeOfError),
      outcomeOfError,
    );
  }, outcomeOfError);
}

function resolverOutcome(core: Core, values: object, signal: AbortSignal, req: Request): Pending {
  const resolver = core.opts.resolver;
  if (resolver === undefined) return { issues: [] };
  const trigger = req.trigger === "init" ? "manual" : req.trigger;
  return checkOf(() => resolver.validate(values, { signal, trigger }), outcomeOfResult);
}

function validatorOutcome(core: Core, values: object, signal: AbortSignal, req: Request): Pending {
  const validate = core.opts.validate;
  if (validate === undefined) return { issues: [] };
  const trigger = req.trigger === "init" ? "manual" : req.trigger;
  return checkOf(
    () => validate(values, { signal, trigger }),
    (done) => ({ issues: asFormIssues(done), output: undefined }),
  );
}

/**
 * An outcome that cannot wait: a promise without the async feature is refused (the promise is
 * ignored, so its rejection is not reported twice) and reported as a form problem.
 */
function syncOutcome(pending: Pending): GlobalOutcome {
  if (!isPromiseLike(pending)) return pending;
  Promise.resolve(pending).catch(() => undefined);
  return {
    issues: [{ segments: [], message: NEEDS_ASYNC, type: "validate", resolver: false }],
  };
}

/** Replaces the resolver-sourced problems and returns the keys whose problems changed. */
function setResolverIssues(core: Core, next: Map<string, Mapped>, changed: Set<string>): void {
  const previous = core.schemaKeys;
  for (const key of previous) {
    if (next.has(key)) continue;
    const rec = core.recs.get(key);
    if (rec === undefined || rec.schema.length === 0) continue;
    rec.schema = NO_ISSUES;
    recomputeTruth(core, rec);
    changed.add(key);
  }
  for (const [key, mapped] of next) {
    const rec = recOf(core, key, () => mapped.parts);
    if (issuesEqual(rec.schema, mapped.issues)) continue;
    rec.schema = mapped.issues;
    recomputeTruth(core, rec);
    changed.add(key);
  }
  core.schemaKeys = new Set(next.keys());
}

/**
 * Maps raw issues to records. Issues on disabled fields are dropped when those are excluded; the
 * ones the resolver reported are collected in `excluded`, because it saw the field as missing and
 * so requires something the form no longer sends.
 */
function mapIssues(
  core: Core,
  raw: readonly RawIssue[],
  excluded: ExcludedIssue[],
): Map<string, Mapped> {
  const out = new Map<string, Mapped>();
  const disabled = core.opts.excludeDisabled ? [...core.disabledKeys] : [];
  for (const issue of raw) {
    let key: string;
    let parts: Part[];
    if (issue.segments.length === 0) {
      key = "";
      parts = [];
    } else {
      const walked = walk(core, issue.segments);
      key = walked.key;
      parts = walked.parts;
    }
    if (disabled.some((prefix) => isUnder(key, prefix))) {
      if (issue.resolver) {
        const path = formatPath(issue.segments);
        if (!excluded.some((known) => known.path === path && known.message === issue.message)) {
          excluded.push({ path, message: issue.message });
        }
      }
      continue;
    }
    let entry = out.get(key);
    if (entry === undefined) {
      entry = { parts, issues: [] };
      out.set(key, entry);
    }
    entry.issues.push({ message: issue.message, type: issue.type });
  }
  return out;
}

/**
 * Applies the outcomes of one pass: the output, the excluded problems and the resolver problems.
 * @internal
 */
export function applyGlobal(
  core: Core,
  outcomes: readonly GlobalOutcome[],
  changed: Set<string>,
): void {
  const raw = outcomes.flatMap((outcome) => outcome.issues);
  const value = outcomes.find((outcome) => outcome.output !== undefined)?.output;
  const excluded: ExcludedIssue[] = [];
  const mapped = mapIssues(core, raw, excluded);
  // A problem the form validator reported on a disabled field is simply dropped. One the resolver
  // reported there means the resolver has no output without that field: nothing to submit.
  core.output = mapped.size === 0 && !raw.some((issue) => issue.resolver) ? value : undefined;
  core.excluded = excluded;
  core.excludedCount.set(excluded.length);
  core.unknown.set(false);
  setResolverIssues(core, mapped, changed);
}

/**
 * Runs the resolver and the form validator. Synchronous answers are applied before this returns;
 * with the async feature a promised answer is applied when it settles (see `internal/async.ts`).
 * Returns `undefined` when nothing is pending.
 * @internal
 */
export function execute(core: Core, req: Request, changed: Set<string>): Promise<void> | undefined {
  const run = core.schemaRun;
  run.controller?.abort();
  run.token += 1;
  const token = run.token;
  const controller = new AbortController();
  run.controller = controller;
  const values = effectiveValues(core);
  const parts: Pending[] = [
    resolverOutcome(core, values, controller.signal, req),
    validatorOutcome(core, values, controller.signal, req),
  ];
  const plug: AsyncPlug | undefined = core.async;
  if (plug !== undefined && parts.some(isPromiseLike)) {
    return plug.settleLater(req, parts, token);
  }
  plug?.syncGlobal();
  applyGlobal(core, parts.map(syncOutcome), changed);
  return undefined;
}

/** The global pass of a request (the entry point of `validate`). */
function runGlobal(core: Core, req: Request, changed: Set<string>): Promise<void> | undefined {
  if (core.opts.resolver === undefined && core.opts.validate === undefined) return undefined;
  if (core.async !== undefined) return core.async.runGlobal(req, changed);
  return execute(core, req, changed);
}

// ---------------------------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------------------------

interface Target {
  readonly segments: Segment[];
  readonly specs: ValidatorSpec<unknown, object>[];
}

/** Every container and leaf path at or below `segments`, plus the ones above it. */
function relatedPaths(raw: unknown, segments: readonly Segment[]): Segment[][] {
  const out: Segment[][] = [];
  for (let length = 1; length < segments.length; length += 1) out.push(segments.slice(0, length));
  const stack: Segment[][] = [[...segments]];
  const seen = new Set<object>();
  for (let path = stack.pop(); path !== undefined; path = stack.pop()) {
    out.push(path);
    const value = getIn(raw, path);
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) continue;
    seen.add(value);
    const keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) => index)
      : Object.keys(value);
    for (const key of keys) stack.push([...path, key]);
  }
  return out;
}

function targetsFor(core: Core, req: Request): Map<string, Target> {
  const out = new Map<string, Target>();
  const add = (segments: Segment[], spec: ValidatorSpec<unknown, object>): void => {
    const key = segments.length === 0 ? "" : keyOfSegments(core, segments);
    let target = out.get(key);
    if (target === undefined) {
      target = { segments, specs: [] };
      out.set(key, target);
    }
    if (!target.specs.includes(spec)) target.specs.push(spec);
  };
  const raw = core.raw();
  if (core.opts.patterns.length > 0) {
    const candidates: Segment[][] =
      req.prefixes === undefined
        ? relatedPaths(raw, [])
        : req.prefixes.flatMap((prefix) => relatedPaths(raw, prefix));
    for (const segments of candidates) {
      if (segments.length === 0) continue;
      for (const entry of core.opts.patterns) {
        if (matchesPattern(entry.pattern, segments)) add(segments, entry.spec);
      }
    }
  }
  for (const entry of core.handleValidators) {
    const segments = [...entry.loc.segments()];
    const related =
      req.prefixes === undefined ||
      req.prefixes.some((prefix) => startsWith(segments, prefix) || startsWith(prefix, segments));
    if (related) add(segments, entry.spec);
  }
  return out;
}

/** Runs the validators of one field. Returns a promise when any of them is asynchronous. */
function runTarget(
  core: Core,
  target: Target,
  req: Request,
  changed: Set<string>,
): Promise<void> | undefined {
  const rec = recOfSegments(core, target.segments);
  const delay = Math.max(0, ...target.specs.map((spec) => spec.debounceMs ?? 0));
  core.async?.cancel(rec);
  // A quiet period: a later change restarts it; blur / submit / trigger() run at once.
  if (delay > 0 && req.trigger === "change" && core.async !== undefined) {
    return core.async.debounceField(rec, req, delay, (later) =>
      evaluate(core, rec, target, req, later),
    );
  }
  return evaluate(core, rec, target, req, changed);
}

/**
 * Runs the validators of one field now.
 * @internal
 */
export function evaluate(
  core: Core,
  rec: Rec,
  target: Target,
  req: Request,
  changed: Set<string>,
): Promise<void> | undefined {
  const value = getIn(core.raw(), target.segments);
  const controller = new AbortController();
  const path = target.segments.length === 0 ? ROOT_PATH : formatPath(target.segments);
  const context = {
    path,
    signal: controller.signal,
    trigger: req.trigger === "init" ? ("manual" as const) : req.trigger,
    values: (): object => snapshot(core.values),
  };
  const sync: FieldIssue[] = [];
  const later: PromiseLike<FieldIssue[]>[] = [];
  for (const spec of target.specs) {
    const result = guarded<FieldIssue[] | PromiseLike<FieldIssue[]>>(
      () => {
        const answer = spec.validate(value, context);
        if (isPromiseLike(answer)) {
          // Without the feature the promise is refused, as the form validator's is.
          if (core.async === undefined) {
            Promise.resolve(answer).catch(() => undefined);
            return [{ message: NEEDS_ASYNC, type: "validate" }];
          }
          return Promise.resolve(answer).then(
            (done) =>
              guarded(
                () => toIssues(done, "validate"),
                (error) => [failureIssue(error)],
              ),
            (error: unknown) => [failureIssue(error)],
          );
        }
        return toIssues(answer, "validate");
      },
      (error) => [failureIssue(error)],
    );
    if (isPromiseLike(result)) later.push(result);
    else sync.push(...result);
  }
  if (later.length === 0 || core.async === undefined) {
    if (!issuesEqual(rec.field, sync)) {
      rec.field = sync.length === 0 ? NO_ISSUES : sync;
      recomputeTruth(core, rec);
      changed.add(rec.key);
    }
    return undefined;
  }
  return core.async.field(rec, req, sync, later, controller, changed);
}

// ---------------------------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------------------------

function shouldShow(core: Core, rec: Rec, req: Request, direct: boolean): boolean {
  if (req.trigger === "init") return false;
  if (req.trigger === "submit" || req.trigger === "manual") return direct;
  const submitted = core.submitCount.peek() > 0;
  const phase = submitted ? core.opts.reValidateOn : core.opts.validateOn;
  // Having met the user once (a blur, or a trigger that showed it) counts as "touched" for the
  // 'touched' rule; before a submit, a revealed problem also keeps following the field.
  const met = rec.slots?.touched.value === true || rec.revealed;
  if (req.trigger === "blur") {
    if (!direct) return false;
    return phase.has("blur") || phase.has("touched") || phase.has("change");
  }
  const live = phase.has("change") || (phase.has("touched") && met) || (!submitted && rec.revealed);
  if (direct) return live;
  // A field other than the one edited follows a rule about it only if the user has met it.
  const interacted = met || submitted || rec.seen;
  return interacted && live;
}

/**
 * Copies truth to what is shown for the records the request is about, and for records whose
 * truth changed during this pass (a rule on one field may fix or break another).
 * @internal
 */
export function reveal(core: Core, req: Request, changed: ReadonlySet<string>): void {
  if (req.trigger === "init") return;
  const prefixKeys = untrack(() =>
    req.prefixes === undefined
      ? undefined
      : req.prefixes.map((prefix) => (prefix.length === 0 ? "" : keyOfSegments(core, prefix))),
  );
  const inScope = (key: string): boolean =>
    prefixKeys === undefined || prefixKeys.some((prefix) => isUnder(key, prefix));
  const consider = (key: string): void => {
    const rec = core.recs.get(key);
    if (rec === undefined) return;
    const direct = inScope(key);
    if (!shouldShow(core, rec, req, direct)) return;
    if (direct && (req.trigger === "submit" || req.trigger === "manual")) rec.revealed = true;
    setShown(core, rec, rec.truth);
  };
  for (const key of changed) consider(key);
  for (const key of core.invalid) consider(key);
  for (const key of core.shownKeys) consider(key);
  if (prefixKeys !== undefined) for (const key of prefixKeys) consider(key);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Runs a validation pass. Everything that can be decided synchronously is applied before this
 * returns; the promise (when there is one) settles after the asynchronous parts did.
 *
 * @param core The form.
 * @param req What triggered the pass and which paths it concerns.
 * @returns A promise when something is still running, otherwise `undefined`.
 * @internal
 */
export function validate(core: Core, req: Request): Promise<void> | undefined {
  if (core.disposed) return undefined;
  const pending: Promise<void>[] = [];
  // Untracked as a whole: the resolver and the validators are the caller's code, and a pass is a
  // side effect of a write, so the effect or event that caused it must not subscribe to them.
  untrack(() =>
    batch(() => {
      const changed = new Set<string>();
      const global = runGlobal(core, req, changed);
      if (global !== undefined) pending.push(global);
      // The first pass (creation, reset) only learns whether the resolver is satisfied: field
      // validators may call a server, so they wait for an edit, a blur, a trigger or a submit.
      if (req.trigger !== "init") {
        for (const target of targetsFor(core, req).values()) {
          const settle = runTarget(core, target, req, changed);
          if (settle !== undefined) pending.push(settle);
        }
      }
      reveal(core, req, changed);
    }),
  );
  if (pending.length === 0) return undefined;
  return Promise.all(pending).then(() => undefined);
}

/**
 * How many times a check (a submit, `trigger()`) runs again because values changed while it waited.
 * @internal
 */
export const MAX_CHECK_ROUNDS = 8;

/**
 * Validates the given paths (all when `undefined`) as `trigger()` does and says whether they are
 * clean. A pass that an edit superseded while it waited answers for old values (its answer is
 * dropped), so the check runs again on what is there now. Bounded by {@link MAX_CHECK_ROUNDS}, so
 * a validator that keeps writing values cannot hold it forever.
 * @internal
 */
export async function validateSettled(
  core: Core,
  prefixes: readonly (readonly Segment[])[] | undefined,
): Promise<boolean> {
  for (let round = 1; ; round += 1) {
    const version = core.version.peek();
    await validate(core, { trigger: "manual", prefixes });
    if (core.version.peek() === version || round >= MAX_CHECK_ROUNDS) {
      return !hasIssues(core, prefixes);
    }
  }
}

/**
 * True when any problem exists at or below the given paths (all paths when `undefined`).
 * @internal
 */
export function hasIssues(
  core: Core,
  prefixes: readonly (readonly Segment[])[] | undefined,
): boolean {
  if (prefixes === undefined) return core.invalid.size > 0;
  const keys = untrack(() =>
    prefixes.map((prefix) => (prefix.length === 0 ? "" : keyOfSegments(core, prefix))),
  );
  for (const key of core.invalid) if (keys.some((prefix) => isUnder(key, prefix))) return true;
  return false;
}
