/**
 * Keys of object types known to the board model (story 7).
 *
 * Kept separate from the client's component registry (src/client/objects/
 * registry.tsx) so the shared board-model can decide "is this type known to
 * the document format" without importing React components. `sticky` has been
 * part of the format since story 2; later stories register their types here
 * (and in the client registry) as they land.
 */

const knownTypes = new Set<string>(['sticky']);

/** Mark `type` as known to the board model (idempotent). */
export function registerObjectTypeKey(type: string): void {
  knownTypes.add(type);
}

/** True when `type` is a known board object type. */
export function isKnownObjectType(type: string): boolean {
  return knownTypes.has(type);
}
