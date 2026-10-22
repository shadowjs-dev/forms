import type { EmptyValue } from "../types";

/**
 * The stored value of an empty text control.
 * @internal
 */
export function emptyOf(policy: EmptyValue): "" | undefined | null {
  if (policy === "undefined") return undefined;
  if (policy === "null") return null;
  return "";
}
