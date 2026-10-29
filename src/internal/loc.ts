/**
 * Locations: how a handle finds its value and its record. A static location is an index path
 * (`lines.2.sku`); a row location is a row id plus a path inside the row, so it keeps pointing at
 * the same row while the list changes.
 * @packageDocumentation
 */
import { formatPath, getIn, type Segment } from "../path";
import { type Core, joinKey, type Loc, type Walked, walk } from "./state";

const NO_SEGMENTS: readonly Segment[] = Object.freeze([]);

/**
 * A location for an index path.
 * @internal
 */
export function staticLoc(core: Core, segments: readonly Segment[]): Loc {
  const frozen = Object.freeze([...segments]);
  const idPath = frozen.length === 0 ? "" : formatPath(frozen);
  return {
    segments: () => frozen,
    resolve: () => walk(core, frozen),
    idPath: () => idPath,
    child: (sub) => staticLoc(core, [...frozen, ...sub]),
  };
}

/**
 * A location inside one row of an array: `sub` is the path below the row (empty for the row
 * itself). The row's current index is read from its row list, so `segments()` follows moves.
 * @internal
 */
export function rowLoc(
  core: Core,
  array: Loc,
  id: string,
  sub: readonly Segment[] = NO_SEGMENTS,
): Loc {
  const frozen = Object.freeze([...sub]);
  const segments = (): readonly Segment[] => {
    const arrayWalked = array.resolve();
    const index = core.rows.get(arrayWalked.key)?.indexCell(id).get() ?? -1;
    return [...array.segments(), index, ...frozen];
  };
  const resolve = (): Walked => {
    const arrayWalked = array.resolve();
    const base = joinKey(arrayWalked.key, id);
    const index = core.rows.get(arrayWalked.key)?.indexCell(id).get() ?? -1;
    const rowValue = getIn(core.raw(), [...array.segments(), index]);
    return walk(core, frozen, {
      key: base,
      node: rowValue,
      parts: [...arrayWalked.parts, { array: arrayWalked.key, id }],
      rows: [...arrayWalked.rows, id],
    });
  };
  return {
    segments,
    resolve,
    idPath: () => {
      const text = array.idPath();
      const tail = frozen.length === 0 ? "" : `-${formatPath(frozen)}`;
      return `${text}-${id.slice(1)}${tail}`;
    },
    child: (more) => rowLoc(core, array, id, [...frozen, ...more]),
  };
}
