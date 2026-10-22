/**
 * Bounded caches of handles: the most entries a form keeps; older ones are recreated on demand.
 * @packageDocumentation
 */

/**
 * The most field and array handles a form keeps; older ones are recreated on demand.
 * @internal
 */
export const MAX_HANDLES = 4096;

/**
 * Returns the entry for `key`, making it (and dropping the oldest entry when the map holds
 * {@link MAX_HANDLES} entries) if needed.
 * @param map The cache, in insertion order.
 * @param key The cache key.
 * @param make Creates the entry when `map` has none for `key`.
 * @returns The cached or newly made entry.
 * @internal
 */
export function remember<T>(
  map: Map<string, T>,
  key: string,
  make: () => T,
  max: number = MAX_HANDLES,
): T {
  const known = map.get(key);
  if (known !== undefined) return known;
  if (map.size >= max) {
    const oldest = map.keys().next();
    if (oldest.done !== true) map.delete(oldest.value);
  }
  const made = make();
  map.set(key, made);
  return made;
}
