/**
 * The state of one form: records keyed by stable field keys, row lists with stable row ids, and
 * the registers every other internal module works on.
 *
 * Stable keys: a field is identified by its path with every array index replaced by the id of the
 * row at that index. Moving or removing rows never rewrites keys: the state of a row (errors,
 * touched flag, controls) stays with the row, and removing a row deletes exactly its records.
 *
 * @packageDocumentation
 */
import type { Store } from "@shadow-js/core";
import { deepEqual } from "../data";
import type { Segment } from "../path";
import type {
  CriteriaMode,
  EmptyValue,
  FieldIssue,
  FormValidateResult,
  FormValidator,
  Resolver,
  ReValidateOn,
  SubmitErrorState,
  ValidateOn,
  ValidatorSpec,
} from "../types";
import type { AsyncPlug } from "./async";
import { Cell } from "./cell";
import type { DatesPlug } from "./controls";
import type { ArrayPlug, RowList } from "./rows";
import { isRecord } from "./shape";

/**
 * Separates the segments of a stable key. User keys cannot contain control characters.
 * @internal
 */
export const SEP = "\u0000";
/** Starts the stand-in id of an index that has no row (yet). */
const MISSING_MARK = "\u0003";

/**
 * The shared empty issue list.
 * @internal
 */
export const NO_ISSUES: readonly FieldIssue[] = Object.freeze([]);

/**
 * A value with an optional reactive cell. The cell is created on the first tracked read, so
 * fields nobody reads cost nothing, and writes skip notification when nobody listens.
 * @internal
 */
export class Slot<T> {
  value: T;
  readonly #equals: (a: T, b: T) => boolean;
  #cell: Cell<T> | undefined;

  constructor(value: T, equals: (a: T, b: T) => boolean = Object.is) {
    this.value = value;
    this.#equals = equals;
  }

  /** Reads and subscribes. */
  get(): T {
    if (this.#cell === undefined) this.#cell = new Cell(this.value, this.#equals);
    return this.#cell.get();
  }

  /** Stores `next`. Returns true when it differs from the current value. */
  set(next: T): boolean {
    if (this.#equals(this.value, next)) return false;
    this.value = next;
    this.#cell?.set(next);
    return true;
  }
}

/**
 * Two issue lists that say the same thing.
 * @internal
 */
export function issuesEqual(a: readonly FieldIssue[], b: readonly FieldIssue[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index];
    const y = b[index];
    if (x?.message !== y?.message || x?.type !== y?.type) return false;
  }
  return true;
}

/**
 * A step of a record's path that goes through an array row.
 * @internal
 */
export interface RowPart {
  /** Stable key of the array. */
  readonly array: string;
  /** Row id. */
  readonly id: string;
}

/**
 * A step of a record's path: a key, or a row.
 * @internal
 */
export type Part = Segment | RowPart;

/**
 * A control bound to a field.
 * @internal
 */
export interface Binding {
  readonly element: Element;
  /** Which handle bound it, to re-check that the record still belongs to it. */
  readonly owner: { readonly key: () => string };
  /** Writes the control from the field's current value, only when it shows something else. */
  readonly sync: () => void;
  composing: boolean;
  /** The control has been on the page. One that is attached and later detached gets forgotten. */
  attached: boolean;
}

/**
 * Reactive flags of a record, created together on first use.
 * @internal
 */
export interface RecSlots {
  readonly shown: Slot<readonly FieldIssue[]>;
  readonly touched: Slot<boolean>;
  readonly validating: Slot<boolean>;
  readonly disabled: Slot<boolean>;
  readonly focused: Slot<boolean>;
}

/**
 * One in-flight asynchronous validation of a field.
 * @internal
 */
export interface Run {
  readonly controller: AbortController;
}

/**
 * The state of one field, container or the form root (key `""`).
 * @internal
 */
export interface Rec {
  readonly key: string;
  readonly parts: readonly Part[];
  slots: RecSlots | undefined;
  /** Problems by source. */
  schema: readonly FieldIssue[];
  field: readonly FieldIssue[];
  server: readonly FieldIssue[];
  manual: readonly FieldIssue[];
  /** All sources merged: the truth about the field, shown or not. */
  truth: readonly FieldIssue[];
  bindings: Map<Element, Binding> | undefined;
  /** A validation trigger (submit, trigger()) showed this record: later changes update it live. */
  revealed: boolean;
  /** This record has shown a problem at some point, so rules about other fields may update it. */
  seen: boolean;
  run: Run | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * A form-level validator as the engine calls it. Method syntax makes it bivariant in the values, so
 * a validator typed for the caller's `TInput` is accepted here (the engine only passes plain data).
 * @internal
 */
export type FormCheck = {
  check(
    values: object,
    context: Parameters<FormValidator<object>>[1],
  ): FormValidateResult | PromiseLike<FormValidateResult>;
}["check"];

/**
 * Options after defaults are applied.
 * @internal
 */
export interface Resolved {
  readonly validateOn: ReadonlySet<ValidateOn>;
  readonly reValidateOn: ReadonlySet<ReValidateOn>;
  readonly debounceMs: number;
  readonly emptyValue: EmptyValue;
  readonly excludeDisabled: boolean;
  readonly shouldFocusError: boolean;
  readonly criteriaMode: CriteriaMode;
  readonly shouldUnregister: boolean;
  readonly resetOnSuccess: boolean | "values";
  /** The resolver of the form (`resolver` option). */
  readonly resolver: Resolver<object, unknown> | undefined;
  readonly validate: FormCheck | undefined;
  /** Pattern validators from the options. */
  readonly patterns: ReadonlyArray<{
    readonly pattern: ReturnType<typeof import("../path").parsePattern>;
    readonly spec: ValidatorSpec<unknown, object>;
  }>;
}

/**
 * A validator attached by a field handle.
 * @internal
 */
export interface HandleValidator {
  readonly loc: Loc;
  readonly spec: ValidatorSpec<unknown, object>;
}

/**
 * Where a handle points: the current index path, and the stable key.
 * @internal
 */
export interface Loc {
  /** The path as indices. Reads row indices, so it follows moves. */
  segments(): readonly Segment[];
  /** The stable key with the path parts needed to create its record. Reads the row lists on the way. */
  resolve(): Walked;
  /** Path text for ids that does not change when rows move. */
  idPath(): string;
  /** The location of a value below this one. */
  child(sub: readonly Segment[]): Loc;
}

/**
 * Everything the internal modules share.
 * @internal
 */
export interface Core {
  readonly id: string;
  readonly opts: Resolved;
  readonly values: Store<object>;
  /** Runs `fn` with a draft of the values. */
  write(fn: (draft: object) => void): void;
  /** Makes the values equal to `next`, notifying only what differs. */
  replace(next: object): void;
  /** The raw values, untracked. Never write to it. */
  raw(): object;
  /** The baseline for dirty checks and reset. */
  defaults: object;

  readonly recs: Map<string, Rec>;
  readonly rows: Map<string, RowList>;
  /** Row id to the keys of the records below it. */
  readonly rowRecs: Map<string, Set<string>>;
  /** Row id to the keys of the arrays below it. */
  readonly rowArrays: Map<string, Set<string>>;
  rowCounter: number;

  /** Keys with a problem (any source). */
  readonly invalid: Set<string>;
  /** Keys whose shown list is not empty. */
  readonly shownKeys: Set<string>;
  /** Keys that currently hold a problem from the schema pass. */
  schemaKeys: Set<string>;
  /** Records with a server or manual problem. */
  readonly pushedKeys: Set<string>;
  /** Records that are disabled. */
  readonly disabledKeys: Set<string>;
  /** Records with bound controls. */
  readonly boundKeys: Set<string>;
  /** Every control that was bound (to recognize the focused one). */
  readonly boundElements: WeakSet<Element>;

  /** Values changed (any write). */
  readonly version: Cell<number>;
  /** A container appeared, disappeared or changed kind. */
  readonly shape: Cell<number>;
  /** Shown problems, touched flags or row order changed: aggregate readers listen. */
  readonly meta: Cell<number>;
  readonly invalidCount: Cell<number>;
  readonly touchedCount: Cell<number>;
  readonly validatingCount: Cell<number>;
  readonly submitCount: Cell<number>;
  readonly submitting: Cell<boolean>;
  readonly submitted: Cell<boolean>;
  readonly successful: Cell<boolean>;
  readonly submitError: Cell<SubmitErrorState | undefined>;

  /** Number of controls composing text (IME). Validation waits. */
  composing: number;
  deferred: ValidationDeferral | undefined;

  /** Validators attached by field handles. */
  readonly handleValidators: Set<HandleValidator>;
  /** The latest schema pass. */
  schemaRun: SchemaRun;
  /** Parsed output of the last clean validation. */
  output: { readonly value: unknown } | undefined;
  /**
   * Paths the schema reported that lie under a disabled field (excluded from the data): the
   * schema requires something the form no longer sends, so no output can be produced.
   */
  excluded: readonly ExcludedIssue[];
  /** `excluded.length`, as a cell so `isValid()` follows it. */
  readonly excludedCount: Cell<number>;
  /** True from creation (or a reset) until the first asynchronous schema answer has been applied. */
  readonly unknown: Cell<boolean>;

  submitToken: number;
  submitController: AbortController | undefined;
  disposed: boolean;
  /** Whether the schema answered asynchronously the last time. */
  schemaAsync: boolean;
  /** True while an asynchronous schema / form-validator pass is running. */
  readonly schemaPending: Cell<boolean>;
  /** True while asynchronous `defaultValues` are loading. */
  readonly loading: Cell<boolean>;
  /** The error the asynchronous `defaultValues` threw. */
  readonly loadError: Cell<unknown>;
  /** Reads the form-level disabled option. */
  readonly formDisabled: () => boolean;

  /** Row lists and their rows: installed by the `arrays` feature, absent otherwise. */
  arrays: ArrayPlug | undefined;
  /** The date family codecs: installed by the `dates` feature, absent otherwise. */
  dates: DatesPlug | undefined;
  /** Promises, debounce and cancellation: installed by the `asyncValidation` feature. */
  async: AsyncPlug | undefined;
  /** Maps a thrown `FormSubmitError` onto fields: installed by the `submitErrors` feature. */
  submitErrors: ((error: unknown) => void) | undefined;
}

/**
 * A schema problem on a disabled field: kept out of the field's own problems, reported on submit.
 * @internal
 */
export interface ExcludedIssue {
  /** Path text of the disabled field. */
  readonly path: string;
  /** What the schema said. */
  readonly message: string;
}

/**
 * What a composition left to do.
 * @internal
 */
export interface ValidationDeferral {
  readonly prefixes: Segment[][];
}

/**
 * State of the latest schema / form-validator pass.
 * @internal
 */
export interface SchemaRun {
  token: number;
  controller: AbortController | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/**
 * Joins a key and a part. The root key is the empty string.
 * @internal
 */
export function joinKey(key: string, part: string): string {
  return key === "" ? part : key + SEP + part;
}

/**
 * True when `key` is `prefix` or lies below it.
 * @internal
 */
export function isUnder(key: string, prefix: string): boolean {
  if (prefix === "") return true;
  return key === prefix || key.startsWith(prefix + SEP);
}

/**
 * Adds `key` to the set of keys `map` holds for the row `id`, creating the set on first use.
 * @internal
 */
export function registerUnder(map: Map<string, Set<string>>, id: string, key: string): void {
  let set = map.get(id);
  if (set === undefined) {
    set = new Set();
    map.set(id, set);
  }
  set.add(key);
}

function rowIdsOf(parts: readonly Part[]): string[] {
  const out: string[] = [];
  for (const part of parts) if (typeof part === "object") out.push(part.id);
  return out;
}

/**
 * The record for `key`, created on first use. `parts` is only read when it must be created.
 * @internal
 */
export function recOf(core: Core, key: string, parts: () => readonly Part[]): Rec {
  const known = core.recs.get(key);
  if (known !== undefined) return known;
  const made = parts();
  const rec: Rec = {
    key,
    parts: made,
    slots: undefined,
    schema: NO_ISSUES,
    field: NO_ISSUES,
    server: NO_ISSUES,
    manual: NO_ISSUES,
    truth: NO_ISSUES,
    bindings: undefined,
    revealed: false,
    seen: false,
    run: undefined,
    timer: undefined,
  };
  core.recs.set(key, rec);
  for (const id of rowIdsOf(made)) registerUnder(core.rowRecs, id, key);
  return rec;
}

/**
 * The reactive flags of a record.
 * @internal
 */
export function slotsOf(rec: Rec): RecSlots {
  if (rec.slots === undefined) {
    rec.slots = {
      shown: new Slot<readonly FieldIssue[]>(NO_ISSUES, issuesEqual),
      touched: new Slot(false),
      validating: new Slot(false),
      disabled: new Slot(false),
      focused: new Slot(false),
    };
  }
  return rec.slots;
}

// ---------------------------------------------------------------------------------------------
// Row lists and keys
// ---------------------------------------------------------------------------------------------

/**
 * What a key walk produces.
 * @internal
 */
export interface Walked {
  readonly key: string;
  readonly parts: Part[];
  readonly rows: string[];
}

function isIndexText(text: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(text);
}

/**
 * Resolves index segments to the stable key. Reads the row lists it passes, so a caller inside
 * an effect re-runs when those rows move. `start` lets a row handle continue from its row.
 * @internal
 */
export function walk(
  core: Core,
  segments: readonly Segment[],
  start: { key: string; node: unknown; parts: Part[]; rows: string[]; from: number },
): Walked {
  let key = start.key;
  let node = start.node;
  const parts = start.parts.slice();
  const rows = start.rows.slice();
  for (const [position, segment] of segments.entries()) {
    if (position < start.from) continue;
    const text = String(segment);
    if (core.arrays !== undefined && Array.isArray(node) && isIndexText(text)) {
      const list = core.arrays.list(key, node.length, rows);
      list.version.get();
      const at = Number(text);
      const id = list.ids[at] ?? `${MISSING_MARK}${text}`;
      parts.push({ array: key, id });
      if (list.ids[at] !== undefined) rows.push(id);
      key = joinKey(key, id);
      node = node[at];
      continue;
    }
    if (typeof segment === "number" || isIndexText(text)) {
      // An index into something that is not (yet) an array: its key changes when the shape does.
      if (!Array.isArray(node)) core.shape.get();
    }
    parts.push(segment);
    key = joinKey(key, text);
    node = isRecord(node) && Object.hasOwn(node, text) ? node[text] : undefined;
  }
  return { key, parts, rows };
}

/**
 * The record a location points to, created on first use.
 * @internal
 */
export function recOfLoc(core: Core, loc: Loc): Rec {
  const walked = loc.resolve();
  return recOf(core, walked.key, () => walked.parts);
}

/**
 * The stable key of an index path.
 * @internal
 */
export function keyOfSegments(core: Core, segments: readonly Segment[]): string {
  return walk(core, segments, { key: "", node: core.raw(), parts: [], rows: [], from: 0 }).key;
}

/**
 * The record of an index path, created on first use.
 * @internal
 */
export function recOfSegments(core: Core, segments: readonly Segment[]): Rec {
  if (segments.length === 0) return rootRec(core);
  const walked = walk(core, segments, { key: "", node: core.raw(), parts: [], rows: [], from: 0 });
  return recOf(core, walked.key, () => walked.parts);
}

/**
 * The record of the form root (problems that belong to no field).
 * @internal
 */
export function rootRec(core: Core): Rec {
  return recOf(core, "", () => []);
}

/**
 * The current index path of a record, or `undefined` when one of its rows is gone.
 * @internal
 */
export function indexPathOf(core: Core, rec: Rec): Segment[] | undefined {
  const out: Segment[] = [];
  for (const part of rec.parts) {
    if (typeof part !== "object") {
      out.push(part);
      continue;
    }
    const at = core.rows.get(part.array)?.index.get(part.id);
    if (at === undefined) return undefined;
    out.push(at);
  }
  return out;
}

/**
 * The default value that belongs to a record: a row is compared with the default of its own
 * origin, so a moved row is not changed. A row added after the defaults (no origin) is compared
 * with the default at its current position, so a row re-added with the default's value is not
 * changed either (it is the same value the form was created with).
 * @internal
 */
export function defaultOf(core: Core, rec: Rec): unknown {
  return defaultAtParts(core, rec.parts);
}

/**
 * {@link defaultOf} for path parts that may not have a record yet.
 * @internal
 */
export function defaultAtParts(core: Core, parts: readonly Part[]): unknown {
  let node: unknown = core.defaults;
  for (const part of parts) {
    if (!isRecord(node)) return undefined;
    let key: string;
    if (typeof part === "object") {
      const list = core.rows.get(part.array);
      const at = list?.origin.get(part.id) ?? list?.index.get(part.id);
      if (at === undefined) return undefined;
      key = String(at);
    } else {
      key = String(part);
    }
    if (!Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Whether a record is dirty, given its current value. A value that differs from its own default
 * (a row compares with its origin, see {@link defaultOf}) is dirty only while the form is: a list
 * that equals its defaults as a whole is clean, so none of its rows or fields is dirty either (the
 * rule `dirtyFields` follows). The form's version is read only when the value differs, so a field
 * that equals its default subscribes to nothing new.
 * @internal
 */
export function isDirtyAgainstDefault(core: Core, rec: Rec, value: unknown): boolean {
  if (deepEqual(value, defaultOf(core, rec))) return false;
  core.version.get();
  return !deepEqual(core.raw(), core.defaults);
}

// ---------------------------------------------------------------------------------------------
// Truth, flags and removal
// ---------------------------------------------------------------------------------------------

/**
 * Announces a change to the aggregate readers (error lists, touched lists).
 * @internal
 */
export function bumpMeta(core: Core): void {
  core.meta.set(core.meta.peek() + 1);
}

/**
 * Merges the sources of a record and keeps the register of invalid keys in step.
 * @internal
 */
export function recomputeTruth(core: Core, rec: Rec): void {
  const parts = [rec.schema, rec.field, rec.server, rec.manual];
  let merged: readonly FieldIssue[] = NO_ISSUES;
  const filled = parts.filter((list) => list.length > 0);
  const [only, second] = filled;
  if (only !== undefined && second === undefined) merged = only;
  else if (second !== undefined) merged = filled.flat();
  rec.truth = merged;
  if (merged.length > 0) {
    if (!core.invalid.has(rec.key)) {
      core.invalid.add(rec.key);
      core.invalidCount.set(core.invalid.size);
    }
  } else if (core.invalid.delete(rec.key)) {
    core.invalidCount.set(core.invalid.size);
  }
}

/**
 * Sets what a record shows.
 * @internal
 */
export function setShown(core: Core, rec: Rec, issues: readonly FieldIssue[]): void {
  if (rec.slots === undefined && issues.length === 0) return;
  if (slotsOf(rec).shown.set(issues)) {
    if (issues.length > 0) {
      rec.seen = true;
      core.shownKeys.add(rec.key);
    } else core.shownKeys.delete(rec.key);
    bumpMeta(core);
  }
}

/**
 * Sets a touched flag and keeps the counter in step.
 * @internal
 */
export function setTouchedFlag(core: Core, rec: Rec, touched: boolean): boolean {
  if (rec.slots === undefined && !touched) return false;
  const changed = slotsOf(rec).touched.set(touched);
  if (changed) {
    core.touchedCount.set(core.touchedCount.peek() + (touched ? 1 : -1));
    bumpMeta(core);
  }
  return changed;
}

/**
 * Forgets the controls of a record that were on the page and are not any more. A control that has
 * not been attached yet (its `ref` runs before it is inserted) is kept.
 * @internal
 */
export function pruneBindings(core: Core, rec: Rec): void {
  if (rec.bindings === undefined) return;
  for (const [element, binding] of rec.bindings) {
    if (element.isConnected) binding.attached = true;
    else if (binding.attached) rec.bindings.delete(element);
  }
  if (rec.bindings.size === 0) {
    rec.bindings = undefined;
    core.boundKeys.delete(rec.key);
  }
}
