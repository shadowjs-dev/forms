/**
 * Field array handles: rows with stable keys, the helpers that change the list, and the row
 * handles. Installed by the `arrays` feature; nothing in the minimal form imports it.
 * @packageDocumentation
 */
import { type Accessor, batch, flushSync, mapArray, untrack } from "@shadow-js/core";
import { plainClone } from "../data";
import { getIn, parsePath, type Segment, setIn } from "../path";
import type { FieldApi, FieldArrayApi, Path, PathValue, RowApi } from "../types";
import type { FieldHost, FieldImpl } from "./field";
import { rowLoc } from "./loc";
import { afterWrite, changedValues, clearPushed, writeValue } from "./mutate";
import {
  dropRowsUnder,
  listOf,
  makeRowIds,
  type RowList,
  removeRowState,
  rowIdOf,
  rowIdText,
} from "./rows";
import { type Core, isDirtyAgainstDefault, type Loc, recOfLoc, walk } from "./state";

/** The most row handles an array keeps before it forgets those of rows that are gone. */
const ROW_HANDLE_SLACK = 16;

/** A row handle. */
function createRow(
  host: FieldHost,
  arrayLoc: Loc,
  id: string,
  listOfArray: () => RowList | undefined,
  removeAt: (index: number) => void,
  moveTo: (from: number, to: number) => void,
): RowApi<unknown> {
  const core = host.core;
  const loc = rowLoc(core, arrayLoc, id);
  const indexNow = (): number => listOfArray()?.indexCell(id).get() ?? -1;
  const handles = new Map<string, FieldImpl>();
  // The overloads are those of `RowApi.field` at an unknown item: a path has no type there, so it
  // is `FieldApi<never>`, which no field handle satisfies. Declared here once, not cast.
  function field(): FieldApi<unknown>;
  function field<P extends Path<NonNullable<unknown>>>(
    path: P,
  ): FieldApi<PathValue<NonNullable<unknown>, P>>;
  function field(path?: string): unknown {
    const text = path ?? "";
    let handle = handles.get(text);
    if (handle === undefined) {
      handle = host.child(text === "" ? loc : loc.child(parsePath(text)));
      handles.set(text, handle);
    }
    return handle;
  }
  return {
    key: rowIdText(id),
    index: indexNow,
    value: () => getIn(core.values, loc.segments()),
    isNew: () => listOfArray()?.origin.has(id) !== true,
    dirty: () =>
      isDirtyAgainstDefault(core, recOfLoc(core, loc), getIn(core.values, loc.segments())),
    field,
    remove: () => {
      const index = untrack(indexNow);
      if (index >= 0) removeAt(index);
    },
    moveTo: (to) => {
      const index = untrack(indexNow);
      if (index >= 0) moveTo(index, to);
    },
  };
}

/**
 * Everything {@link createArray} adds to the public handle.
 * @internal
 */
export interface ArrayImpl extends FieldArrayApi<unknown> {
  readonly loc: Loc;
}

/**
 * Creates the array handle for a location.
 * @param host The form's core and child factory.
 * @param loc The array's location.
 * @internal
 */
export function createArray(host: FieldHost, loc: Loc): ArrayImpl {
  const core: Core = host.core;
  const segmentsNow = (): Segment[] => untrack(() => [...loc.segments()]);
  const rowHandles = new Map<string, RowApi<unknown>>();

  /** The row list, kept in step with the array length. Tracks the length and the list version. */
  const listNow = (): RowList => {
    const walked = loc.resolve();
    const current = getIn(core.values, loc.segments());
    const length = Array.isArray(current) ? current.length : 0;
    return listOf(core, walked.key, length, walked.rows);
  };
  const listPeek = (): RowList | undefined => core.rows.get(untrack(() => loc.resolve().key));

  const rowOf = (id: string): RowApi<unknown> => {
    const known = rowHandles.get(id);
    if (known !== undefined) return known;
    if (
      rowHandles.size >
      (core.rows.get(untrack(() => loc.resolve().key))?.ids.length ?? 0) + ROW_HANDLE_SLACK
    ) {
      const list = listPeek();
      for (const other of rowHandles.keys())
        if (list?.index.has(other) !== true) rowHandles.delete(other);
    }
    const made = createRow(
      host,
      loc,
      id,
      listPeek,
      (index) => removeRows(core, segmentsNow(), [index]),
      (from, to) => moveRow(core, segmentsNow(), from, to),
    );
    rowHandles.set(id, made);
    return made;
  };

  const handle: ArrayImpl = {
    loc,
    get path() {
      return loc.segments().join(".");
    },
    keys: () =>
      listNow()
        .keys()
        .map((id) => rowIdText(id)),
    length: () => {
      const current = getIn(core.values, loc.segments());
      return Array.isArray(current) ? current.length : 0;
    },
    row(key) {
      const id = rowIdOf(key);
      const list = untrack(() => {
        arrayState(core, segmentsNow());
        return listPeek();
      });
      if (id === undefined || list?.index.has(id) !== true) {
        throw new RangeError(`[forms] "${segmentsNow().join(".")}" has no row "${key}"`);
      }
      return rowOf(id);
    },
    at(index) {
      const state = arrayState(core, segmentsNow());
      const id = state.list.ids[index];
      if (id === undefined) {
        throw new RangeError(`[forms] "${state.segments.join(".")}" has no row at ${index}`);
      }
      return rowOf(id);
    },
    append: (...items) =>
      insertRows(core, segmentsNow(), arrayState(core, segmentsNow()).length, items),
    prepend: (...items) => insertRows(core, segmentsNow(), 0, items),
    insert: (index, ...items) => insertRows(core, segmentsNow(), index, items),
    remove: (index) => removeRows(core, segmentsNow(), typeof index === "number" ? [index] : index),
    move: (from, to) => moveRow(core, segmentsNow(), from, to),
    swap: (a, b) => swapRows(core, segmentsNow(), a, b),
    update(index, item) {
      const state = arrayState(core, segmentsNow());
      if (!Number.isInteger(index) || index < 0 || index >= state.length) {
        throw new RangeError(`[forms] "${state.segments.join(".")}" has no row at ${index}`);
      }
      writeValue(core, [...state.segments, index], item, {});
    },
    replace: (items) => replaceRows(core, segmentsNow(), items),
    clear: () => replaceRows(core, segmentsNow(), []),
    each<R>(render: (row: RowApi<unknown>, index: Accessor<number>) => R): Accessor<R[]> {
      return mapArray(
        () => listNow().keys(),
        (id) => {
          const row = rowOf(id);
          return render(row, row.index);
        },
      );
    },
  };
  return handle;
}

// ---------------------------------------------------------------------------------------------
// Array operations (what the handles call)
// ---------------------------------------------------------------------------------------------

/**
 * The array at a path with its row list.
 * @internal
 */
export interface ArrayState {
  readonly segments: Segment[];
  readonly key: string;
  readonly list: ReturnType<typeof listOf>;
  readonly length: number;
}

/**
 * Resolves the array at `segments`; a missing array counts as empty.
 * @internal
 */
export function arrayState(core: Core, segments: readonly Segment[]): ArrayState {
  return untrack(() => {
    const walked = walk(core, segments, {
      key: "",
      node: core.raw(),
      parts: [],
      rows: [],
      from: 0,
    });
    const current = getIn(core.raw(), segments);
    if (current !== undefined && current !== null && !Array.isArray(current)) {
      throw new TypeError(`[forms] "${segments.join(".")}" is not an array`);
    }
    const length = Array.isArray(current) ? current.length : 0;
    const list = listOf(core, walked.key, length, walked.rows);
    return { segments: [...segments], key: walked.key, list, length };
  });
}

function checkIndex(index: number, max: number, path: string, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new RangeError(`[forms] cannot ${what} ${index} in "${path}" (valid: 0 to ${max})`);
  }
}

/** Keeps focus on a control that a DOM move would blur. */
function keepingFocus(core: Core, fn: () => void): void {
  const active = typeof document === "undefined" ? null : document.activeElement;
  fn();
  if (active === null || !(active instanceof HTMLElement) || !core.boundElements.has(active))
    return;
  // Rows move in the flush; once it ran, put focus back where it was.
  flushSync();
  if (active.isConnected && document.activeElement !== active) active.focus();
}

/**
 * Applies a change to an array: the values change in the store, the row list in step, and one
 * validation pass runs. `edit` receives the draft array and returns the ids of removed rows.
 */
function editArray(
  core: Core,
  state: ArrayState,
  edit: (array: unknown[], list: ArrayState["list"]) => string[],
  options: { reorders: boolean },
): void {
  const run = (): void => {
    batch(() => {
      let removed: string[] = [];
      core.write((draft) => {
        let array = getIn(draft, state.segments);
        if (array === undefined || array === null) {
          setIn(draft, state.segments, []);
          array = getIn(draft, state.segments);
        }
        if (!Array.isArray(array)) {
          throw new TypeError(`[forms] "${state.segments.join(".")}" is not an array`);
        }
        removed = edit(array, state.list);
      });
      if (removed.length > 0) removeRowState(core, removed);
      state.list.changed();
      changedValues(core, state.length === 0);
      afterWrite(core, [state.segments]);
    });
  };
  if (options.reorders) keepingFocus(core, run);
  else run();
}

/**
 * Inserts values before `index`.
 * @internal
 */
export function insertRows(
  core: Core,
  segments: readonly Segment[],
  index: number,
  items: readonly unknown[],
): void {
  if (items.length === 0) return;
  const state = arrayState(core, segments);
  checkIndex(index, state.length, state.segments.join("."), "insert at");
  const ids = makeRowIds(core, items.length);
  editArray(
    core,
    state,
    (array, list) => {
      array.splice(index, 0, ...items.map((item) => plainClone(item)));
      list.ids.splice(index, 0, ...ids);
      list.reindex(index);
      return [];
    },
    { reorders: index < state.length },
  );
}

/**
 * Removes rows by index.
 * @internal
 */
export function removeRows(
  core: Core,
  segments: readonly Segment[],
  indices: readonly number[],
): void {
  const state = arrayState(core, segments);
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  for (const index of sorted)
    checkIndex(index, state.length - 1, state.segments.join("."), "remove");
  if (sorted.length === 0) return;
  editArray(
    core,
    state,
    (array, list) => {
      const removed: string[] = [];
      for (const index of sorted) {
        array.splice(index, 1);
        const [id] = list.ids.splice(index, 1);
        if (id !== undefined) {
          removed.push(id);
          list.forget(id);
        }
      }
      // `sorted` is in descending order: its lowest index is where the shifting starts.
      list.reindex(sorted.reduce((lowest, index) => Math.min(lowest, index), Infinity));
      return removed;
    },
    { reorders: true },
  );
}

/**
 * Moves a row.
 * @internal
 */
export function moveRow(core: Core, segments: readonly Segment[], from: number, to: number): void {
  const state = arrayState(core, segments);
  const path = state.segments.join(".");
  checkIndex(from, state.length - 1, path, "move from");
  checkIndex(to, state.length - 1, path, "move to");
  if (from === to) return;
  editArray(
    core,
    state,
    (array, list) => {
      // Rotate the slots between the two positions. A splice pair would shift (and notify) every
      // row after them; this touches only the rows whose position changes.
      const item = array[from];
      if (from < to) for (let at = from; at < to; at += 1) array[at] = array[at + 1];
      else for (let at = from; at > to; at -= 1) array[at] = array[at - 1];
      array[to] = item;
      const [id] = list.ids.splice(from, 1);
      if (id !== undefined) list.ids.splice(to, 0, id);
      list.reindex(Math.min(from, to), Math.max(from, to) + 1);
      return [];
    },
    { reorders: true },
  );
}

/**
 * Swaps two rows.
 * @internal
 */
export function swapRows(core: Core, segments: readonly Segment[], a: number, b: number): void {
  const state = arrayState(core, segments);
  const path = state.segments.join(".");
  checkIndex(a, state.length - 1, path, "swap");
  checkIndex(b, state.length - 1, path, "swap");
  if (a === b) return;
  editArray(
    core,
    state,
    (array, list) => {
      const first = array[a];
      array[a] = array[b];
      array[b] = first;
      const idA = list.ids[a];
      const idB = list.ids[b];
      if (idA !== undefined && idB !== undefined) {
        list.ids[a] = idB;
        list.ids[b] = idA;
      }
      list.reindex(Math.min(a, b), Math.max(a, b) + 1);
      return [];
    },
    { reorders: true },
  );
}

/**
 * Replaces all rows. New rows get new ids.
 * @internal
 */
export function replaceRows(
  core: Core,
  segments: readonly Segment[],
  items: readonly unknown[],
): void {
  const state = arrayState(core, segments);
  batch(() => {
    dropRowsUnder(core, state.key);
    core.write((draft) =>
      setIn(
        draft,
        state.segments,
        items.map((item) => plainClone(item)),
      ),
    );
    changedValues(core, true);
    clearPushed(core, state.key, ["server", "manual"]);
    afterWrite(core, [state.segments]);
  });
}
