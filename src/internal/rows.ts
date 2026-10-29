/**
 * Row lists of field arrays: row ids, their order and their origin (the index they had among the
 * defaults), and the removal of a removed row's state. Only the `arrays` feature installs them; a
 * form without it has no rows and its array items are plain index keys.
 * @packageDocumentation
 */
import { Cell } from "./cell";
import { bumpMeta, type Core, isUnder, type Rec, registerUnder } from "./state";

/** Starts every row id. */
const ROW_MARK = "\u0001";

/** The id of the n-th row, in a form that cannot clash with a user key. */
function newRowId(core: Core): string {
  core.rowCounter += 1;
  return ROW_MARK + core.rowCounter.toString(36);
}

/**
 * The public spelling of a row id (`r1a`): safe in DOM ids and as a list key.
 * @internal
 */
export function rowIdText(id: string): string {
  return `r${id.slice(1)}`;
}

/**
 * The row id for a public row key, or `undefined` when the key is not one.
 * @internal
 */
export function rowIdOf(key: string): string | undefined {
  return key.startsWith("r") ? ROW_MARK + key.slice(1) : undefined;
}

/**
 * The rows of one array: ids in order, with the registers that make them cheap to follow.
 * @internal
 */
export class RowList {
  readonly arrayKey: string;
  /** Row ids in order. */
  ids: string[] = [];
  /** Row id to current index. */
  readonly index: Map<string, number> = new Map();
  /** Row id to the index it had among the default values. Rows without one are new. */
  readonly origin: Map<string, number> = new Map();
  /** Bumped by every structural change. */
  readonly version: Cell<number> = new Cell(0);
  readonly #indexCells: Map<string, Cell<number>> = new Map();
  #snapshot: readonly string[] | undefined;

  constructor(arrayKey: string) {
    this.arrayKey = arrayKey;
  }

  /** The ids as an immutable list, copied once per change. */
  keys(): readonly string[] {
    this.version.get();
    this.#snapshot ??= this.ids.slice();
    return this.#snapshot;
  }

  /** A cell that follows the row's index. */
  indexCell(id: string): Cell<number> {
    let cell = this.#indexCells.get(id);
    if (cell === undefined) {
      cell = new Cell(this.index.get(id) ?? -1);
      this.#indexCells.set(id, cell);
    }
    return cell;
  }

  /** Re-numbers rows from `from` up to (not including) `until`. Only rows whose index changed notify. */
  reindex(from: number, until: number = this.ids.length): void {
    const end = Math.min(until, this.ids.length);
    for (const [offset, id] of this.ids.slice(from, end).entries()) {
      const position = from + offset;
      this.index.set(id, position);
      this.#indexCells.get(id)?.set(position);
    }
  }

  /** Forgets a row's registers (after it left the list). */
  forget(id: string): void {
    this.index.delete(id);
    this.origin.delete(id);
    const cell = this.#indexCells.get(id);
    cell?.set(-1);
    this.#indexCells.delete(id);
  }

  /** Announces a structural change. */
  changed(): void {
    this.#snapshot = undefined;
    this.version.set(this.version.peek() + 1);
  }
}

/**
 * What the form asks of its rows. The state layer calls these; a form without the `arrays`
 * feature has none of them.
 * @internal
 */
export interface ArrayPlug {
  /** The row list of the array at `key`, created from its length on first use and kept in step with it. */
  readonly list: (key: string, length: number, parentRows: readonly string[]) => RowList;
  /** Drops the row lists at and below `prefix`, with the state of their rows. */
  readonly dropUnder: (prefix: string) => void;
  /** Drops the row at `index` of the array at `key`, with its state, when the item left the data by a path (`unregister`). */
  readonly removeRow: (key: string, index: number) => void;
  /** Forgets every row list (a reset that replaces the values). */
  readonly reset: () => void;
  /** Whether the rows of the array at `key` are not in their default order (or are new). */
  readonly moved: (key: string) => boolean;
}

/**
 * Creates the row list of the array at `arrayKey`, from its length on first use.
 * @internal
 */
export function listOf(
  core: Core,
  arrayKey: string,
  length: number,
  parentRows: readonly string[],
): RowList {
  let list = core.rows.get(arrayKey);
  if (list === undefined) {
    list = new RowList(arrayKey);
    core.rows.set(arrayKey, list);
    for (const id of parentRows) registerUnder(core.rowArrays, id, arrayKey);
    for (let position = 0; position < length; position += 1) {
      const id = newRowId(core);
      list.ids.push(id);
      list.index.set(id, position);
      list.origin.set(id, position);
    }
    return list;
  }
  if (list.ids.length < length) {
    // Rows appeared without going through the array helpers (a write past the end): they are new.
    const from = list.ids.length;
    for (let position = from; position < length; position += 1) {
      const id = newRowId(core);
      list.ids.push(id);
      list.index.set(id, position);
    }
    list.changed();
  } else if (list.ids.length > length) {
    const removed = list.ids.splice(length);
    for (const id of removed) list.forget(id);
    removeRowState(core, removed);
    list.changed();
  }
  return list;
}

/**
 * Appends fresh ids for `count` new rows (after the helper already inserted the values).
 * @internal
 */
export function makeRowIds(core: Core, count: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) out.push(newRowId(core));
  return out;
}

/** Deletes one record and everything the registers hold about it. */
function removeRec(core: Core, key: string): void {
  const rec: Rec | undefined = core.recs.get(key);
  if (rec === undefined) return;
  core.async?.cancel(rec);
  if (rec.slots?.touched.value === true) {
    core.touchedCount.set(core.touchedCount.peek() - 1);
  }
  if (core.invalid.delete(key)) core.invalidCount.set(core.invalid.size);
  core.shownKeys.delete(key);
  core.schemaKeys.delete(key);
  core.pushedKeys.delete(key);
  core.disabledKeys.delete(key);
  core.boundKeys.delete(key);
  core.recs.delete(key);
}

/**
 * Deletes the state of removed rows: their records, and the row lists (with their rows, and so
 * on) of arrays nested in them. Iterative; the work is proportional to what is removed.
 * @internal
 */
export function removeRowState(core: Core, ids: readonly string[]): void {
  const pending = ids.slice();
  let removed = false;
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const keys = core.rowRecs.get(id);
    if (keys !== undefined) {
      for (const key of keys) {
        removeRec(core, key);
        removed = true;
      }
      core.rowRecs.delete(id);
    }
    const arrays = core.rowArrays.get(id);
    if (arrays !== undefined) {
      for (const arrayKey of arrays) {
        const list = core.rows.get(arrayKey);
        if (list === undefined) continue;
        core.rows.delete(arrayKey);
        for (const nested of list.ids) pending.push(nested);
      }
      core.rowArrays.delete(id);
    }
  }
  if (removed) bumpMeta(core);
}

/**
 * Drops the row lists at and below `prefix` (their arrays were replaced), with the state of
 * their rows. Rows then get new ids the next time they are read.
 * @internal
 */
export function dropRowsUnder(core: Core, prefix: string): void {
  const ids: string[] = [];
  for (const [arrayKey, list] of core.rows) {
    if (!isUnder(arrayKey, prefix)) continue;
    core.rows.delete(arrayKey);
    list.changed();
    for (const id of list.ids) ids.push(id);
  }
  if (ids.length > 0) removeRowState(core, ids);
}

/**
 * The row plug of a form: installed by the `arrays` feature, it is the only code that creates or
 * removes row lists.
 * @internal
 */
export function createRowsPlug(core: Core): ArrayPlug {
  return {
    list: (key, length, parentRows) => listOf(core, key, length, parentRows),
    dropUnder: (prefix) => dropRowsUnder(core, prefix),
    removeRow(key, index) {
      const list = core.rows.get(key);
      const id = list?.ids.splice(index, 1)[0];
      if (list === undefined || id === undefined) return;
      list.forget(id);
      list.reindex(index);
      removeRowState(core, [id]);
      list.changed();
    },
    reset() {
      const rowIds: string[] = [];
      for (const list of core.rows.values()) {
        list.changed();
        rowIds.push(...list.ids);
      }
      core.rows.clear();
      removeRowState(core, rowIds);
    },
    moved(key) {
      const list = core.rows.get(key);
      if (list === undefined) return false;
      // A row without an origin is compared with its position (see `defaultAtParts`), so it does not move.
      return list.ids.some((rowId, position) => (list.origin.get(rowId) ?? position) !== position);
    },
  };
}
