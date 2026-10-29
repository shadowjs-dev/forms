/**
 * Everything that changes a form: writes, resets, touched flags, pushed problems (manual and
 * server) and the array helpers. Each operation is one batch, so readers see one consistent
 * update.
 * @packageDocumentation
 */
import { batch } from "@shadow-js/core";
import { deepEqual, isContainer, plainClone } from "../data";
import { deleteIn, formatPath, getIn, type Segment, setIn } from "../path";
import type { FieldIssue, ResetOptions, UnregisterOptions } from "../types";
import {
  bumpMeta,
  type Core,
  defaultOf,
  indexPathOf,
  isUnder,
  keyOfSegments,
  NO_ISSUES,
  pruneBindings,
  type Rec,
  recOfSegments,
  recomputeTruth,
  setShown,
  setTouchedFlag,
  slotsOf,
} from "./state";
import { validate } from "./validate";

/**
 * The value at an index path, read without subscribing.
 * @internal
 */
export function peekAt(core: Core, segments: readonly Segment[]): unknown {
  return getIn(core.raw(), segments);
}

/**
 * Bumps the counters readers of "anything changed" use.
 * @internal
 */
export function changedValues(core: Core, shape: boolean): void {
  core.version.set(core.version.peek() + 1);
  if (shape) core.shape.set(core.shape.peek() + 1);
  bumpMeta(core);
}

// ---------------------------------------------------------------------------------------------
// Problems pushed from outside (manual, server)
// ---------------------------------------------------------------------------------------------

/**
 * Which hand-set source a problem list belongs to.
 * @internal
 */
export type PushedSource = "server" | "manual";

/**
 * Replaces the server or manual problems of a record and shows them at once. Problems of other
 * sources keep their visibility rules.
 * @internal
 */
export function pushIssues(
  core: Core,
  rec: Rec,
  source: PushedSource,
  issues: readonly FieldIssue[],
): void {
  const previous = rec[source];
  rec[source] = issues.length === 0 ? NO_ISSUES : issues;
  recomputeTruth(core, rec);
  if (rec.server.length > 0 || rec.manual.length > 0) core.pushedKeys.add(rec.key);
  else core.pushedKeys.delete(rec.key);
  const shown = rec.slots?.shown.value ?? NO_ISSUES;
  const base = shown.filter((issue) => !previous.includes(issue));
  setShown(core, rec, [...base, ...issues]);
}

/**
 * Removes server and manual problems at and below `prefix` (a stable key).
 * @internal
 */
export function clearPushed(core: Core, prefix: string, sources: readonly PushedSource[]): void {
  for (const key of [...core.pushedKeys]) {
    if (!isUnder(key, prefix)) continue;
    const rec = core.recs.get(key);
    if (rec === undefined) continue;
    for (const source of sources) if (rec[source].length > 0) pushIssues(core, rec, source, []);
  }
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/**
 * Options of a write.
 * @internal
 */
export interface WriteOptions {
  readonly validate?: boolean | undefined;
  readonly touch?: boolean | undefined;
}

/**
 * Runs the validation a write asks for, or postpones it while text is being composed.
 * @internal
 */
export function afterWrite(
  core: Core,
  prefixes: readonly (readonly Segment[])[],
  trigger: "change" | "manual" = "change",
): void {
  if (core.composing > 0) {
    const pending = core.deferred ?? { prefixes: [] };
    for (const prefix of prefixes) pending.prefixes.push([...prefix]);
    core.deferred = pending;
    return;
  }
  // A pass that runs now also covers what was postponed while text was being composed.
  const postponed = core.deferred?.prefixes ?? [];
  core.deferred = undefined;
  validate(core, { trigger, prefixes: [...postponed, ...prefixes] });
}

/** True when a write would store what is already there. */
function unchanged(previous: unknown, value: unknown): boolean {
  return deepEqual(previous, value) && (previous !== undefined || value === undefined);
}

/**
 * Stores one value at a record: the one step both {@link writeValue} and {@link writeMany} take.
 * Validation is the caller's to run.
 */
function store(
  core: Core,
  rec: Rec,
  segments: readonly Segment[],
  previous: unknown,
  value: unknown,
): void {
  const structural = isContainer(previous) || isContainer(value) || previous === undefined;
  if (structural) core.arrays?.dropUnder(rec.key);
  core.write((draft) => setIn(draft, segments, value));
  changedValues(core, structural);
  clearPushed(core, rec.key, ["server", "manual"]);
}

/**
 * Writes the value at an index path: the one place a single value is stored.
 * @internal
 */
export function writeValue(
  core: Core,
  segments: readonly Segment[],
  next: unknown,
  options: WriteOptions = {},
): void {
  batch(() => {
    dropDetached(core);
    const previous = peekAt(core, segments);
    const value = plainClone(next);
    const rec = recOfSegments(core, segments);
    if (options.touch === true) setTouchedFlag(core, rec, true);
    if (unchanged(previous, value)) return;
    store(core, rec, segments, previous, value);
    if (options.validate !== false) afterWrite(core, [segments]);
  });
}

/**
 * One write of {@link writeMany}.
 * @internal
 */
export interface Write {
  readonly segments: readonly Segment[];
  readonly value: unknown;
}

/**
 * Writes several values as one change with one validation pass.
 * @internal
 */
export function writeMany(core: Core, writes: readonly Write[], options: WriteOptions = {}): void {
  batch(() => {
    dropDetached(core);
    const touched: Segment[][] = [];
    for (const write of writes) {
      const previous = peekAt(core, write.segments);
      const value = plainClone(write.value);
      if (unchanged(previous, value)) continue;
      store(core, recOfSegments(core, write.segments), write.segments, previous, value);
      touched.push([...write.segments]);
    }
    if (options.touch === true) {
      for (const write of writes) setTouchedFlag(core, recOfSegments(core, write.segments), true);
    }
    if (touched.length > 0 && options.validate !== false) afterWrite(core, touched);
  });
}

/**
 * Flattens a partial value into writes: objects merge, everything else replaces.
 * @internal
 */
export function writesOf(core: Core, partial: unknown, prefix: readonly Segment[] = []): Write[] {
  const out: Write[] = [];
  const stack: Array<{ segments: readonly Segment[]; value: unknown }> = [
    { segments: prefix, value: partial },
  ];
  const seen = new Set<object>();
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { segments, value } = item;
    if (isContainer(value) && !Array.isArray(value)) {
      if (seen.has(value)) continue;
      seen.add(value);
      const current = peekAt(core, segments);
      const keys = Object.keys(value);
      if (keys.length === 0 && segments.length > 0 && !isContainer(current)) {
        out.push({ segments, value: {} });
        continue;
      }
      for (const key of keys) {
        stack.push({
          segments: [...segments, key],
          value: value[key],
        });
      }
      continue;
    }
    if (segments.length > 0) out.push({ segments, value });
  }
  // Check every path before the first write: a refused set of values changes nothing.
  for (const write of out) formatPath(write.segments);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Touched, disabled
// ---------------------------------------------------------------------------------------------

/**
 * Sets the touched flag of one record.
 * @internal
 */
export function setTouched(core: Core, rec: Rec, touched: boolean): void {
  batch(() => {
    setTouchedFlag(core, rec, touched);
  });
}

/**
 * Marks a field disabled (excluded from validation and the submitted data) or enabled again.
 * @internal
 */
export function setDisabledFlag(core: Core, rec: Rec, disabled: boolean): void {
  batch(() => {
    if (rec.slots === undefined && !disabled) return;
    if (slotsOf(rec).disabled.set(disabled)) {
      if (disabled) core.disabledKeys.add(rec.key);
      else core.disabledKeys.delete(rec.key);
      validate(core, { trigger: "init" });
      bumpMeta(core);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------------------------

/** Which parts of a record a reset keeps. */
interface ClearKeep {
  readonly errors?: boolean | undefined;
  readonly touched?: boolean | undefined;
}

/** Clears sources, flags and work of a record in place (readers keep their subscriptions). */
function clearRec(core: Core, rec: Rec, keep: ClearKeep = {}): void {
  core.async?.cancel(rec);
  if (keep.errors !== true) {
    rec.schema = NO_ISSUES;
    rec.field = NO_ISSUES;
    rec.server = NO_ISSUES;
    rec.manual = NO_ISSUES;
    rec.revealed = false;
    rec.seen = false;
    recomputeTruth(core, rec);
    core.pushedKeys.delete(rec.key);
    core.schemaKeys.delete(rec.key);
    if (rec.slots !== undefined) setShown(core, rec, NO_ISSUES);
  }
  if (keep.touched !== true && rec.slots !== undefined) setTouchedFlag(core, rec, false);
}

/** Stops everything in flight for a new start: submit, schema pass, field runs. */
function stopWork(core: Core): void {
  core.submitToken += 1;
  core.submitController?.abort();
  core.submitController = undefined;
  const run = core.schemaRun;
  run.controller?.abort();
  run.controller = undefined;
  run.token += 1;
  core.async?.stop();
}

/**
 * Restores the form. Records of fields keep their identity (their readers stay subscribed) and
 * go back to the clean state; rows are discarded together with their records, because a reset
 * brings back the rows of the defaults under new ids.
 *
 * `options` keeps parts of the state (React Hook Form's names): with `keepValues` the values and
 * their rows stay; `keepDefaultValues` (and `keepDirty`) keep the old baseline, so `isDirty`
 * compares with it; the other flags keep problems, touched fields and the submit counters.
 *
 * @param core The form.
 * @param defaults New default values, or `undefined` to restore the current ones.
 * @param options What to keep.
 * @internal
 */
export function resetAll(
  core: Core,
  defaults: object | undefined,
  options: ResetOptions = {},
): void {
  batch(() => {
    stopWork(core);
    core.deferred = undefined;
    core.composing = 0;
    core.submitting.set(false);
    if (options.keepSubmitCount !== true) core.submitCount.set(0);
    if (options.keepIsSubmitted !== true) {
      core.submitted.set(false);
      core.submitError.set(undefined);
    }
    if (options.keepIsSubmitSuccessful !== true) core.successful.set(false);
    // The values that come in with a reset: the argument, or the current baseline.
    const source = defaults ?? core.defaults;
    const keepBaseline = options.keepDefaultValues === true || options.keepDirty === true;
    if (defaults !== undefined && !keepBaseline) core.defaults = plainClone(defaults);
    const replaceValues = options.keepValues !== true;
    if (replaceValues) core.arrays?.reset();
    const keep = { errors: options.keepErrors, touched: options.keepTouched };
    for (const rec of core.recs.values()) clearRec(core, rec, keep);
    core.output = undefined;
    if (replaceValues) {
      core.replace(plainClone(source));
      changedValues(core, true);
    } else {
      changedValues(core, false);
    }
    for (const key of [...core.boundKeys]) {
      const rec = core.recs.get(key);
      if (rec === undefined) continue;
      pruneBindings(core, rec);
      for (const binding of rec.bindings?.values() ?? []) binding.sync();
    }
    validate(core, { trigger: "init" });
  });
}

/**
 * Forgets a field (React Hook Form's `unregister`): its problems and touched flag go, its controls
 * are no longer bound, and its value is removed from the data unless `keepValue`.
 *
 * @param core The form.
 * @param segments The path of the field.
 * @param options What to keep.
 * @internal
 */
export function unregisterPath(
  core: Core,
  segments: readonly Segment[],
  options: UnregisterOptions = {},
): void {
  batch(() => {
    const rec = recOfSegments(core, segments);
    const key = rec.key;
    const keep = { errors: options.keepError, touched: options.keepTouched };
    for (const other of core.recs.values()) {
      if (!isUnder(other.key, key)) continue;
      clearRec(core, other, keep);
      other.bindings = undefined;
      core.boundKeys.delete(other.key);
    }
    if (options.keepValue !== true) {
      const previous = peekAt(core, segments);
      if (isContainer(previous)) core.arrays?.dropUnder(key);
      // An item of an array leaves it by splice, so its row goes too: the rows after it keep their ids and state.
      const parent = segments.slice(0, -1);
      const index = Number(segments[segments.length - 1]);
      const list = peekAt(core, parent);
      if (Array.isArray(list) && Number.isInteger(index) && index >= 0 && index < list.length) {
        core.arrays?.removeRow(keyOfSegments(core, parent), index);
      }
      core.write((draft) => {
        deleteIn(draft, segments);
      });
      changedValues(core, true);
    }
    validate(core, { trigger: "init" });
  });
}

/**
 * With `shouldUnregister`: a field whose every bound control left the page loses its value and its
 * problems. Runs before each write, so a removed control is noticed by the next change of the form.
 * Only controls that were on the page when they were bound count: a control that never attached
 * (its `ref` ran before insertion) is kept.
 */
function dropDetached(core: Core): void {
  if (!core.opts.shouldUnregister || core.boundKeys.size === 0) return;
  for (const key of [...core.boundKeys]) {
    const rec = core.recs.get(key);
    if (rec === undefined || rec.bindings === undefined) continue;
    let left = false;
    for (const [element, binding] of rec.bindings) {
      if (!element.isConnected && binding.attached) {
        rec.bindings.delete(element);
        left = true;
      }
    }
    if (rec.bindings.size > 0 || !left) continue;
    rec.bindings = undefined;
    core.boundKeys.delete(key);
    const segments = indexPathOf(core, rec);
    if (segments !== undefined) unregisterPath(core, segments, {});
  }
}

/**
 * Restores one field: its default value (rows use their own), no problems, not touched.
 * @internal
 */
export function resetPath(core: Core, segments: readonly Segment[]): void {
  batch(() => {
    const rec = recOfSegments(core, segments);
    const fallback = plainClone(defaultOf(core, rec));
    const key = rec.key;
    writeValue(core, segments, fallback, { validate: false });
    for (const other of core.recs.values()) if (isUnder(other.key, key)) clearRec(core, other);
    for (const k of core.boundKeys) {
      if (!isUnder(k, key)) continue;
      for (const binding of core.recs.get(k)?.bindings?.values() ?? []) binding.sync();
    }
    validate(core, { trigger: "init" });
  });
}
