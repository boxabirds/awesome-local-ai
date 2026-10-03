/**
 * Shared set of object type names known to the board model (story 7).
 *
 * The client-side React registry (`src/client/objects/registry.tsx`) is the
 * source of truth for per-type component and resize rules, but the board
 * model (shared, also used by the worker) cannot import client code. When a
 * type is registered on the client it marks itself here so that
 * `board-model.allObjectIds` can exclude unregistered (unknown) types.
 */

const registeredTypes = new Set<string>();

/** Mark a type as registered (called by the client registry). */
export function markObjectTypeRegistered(type: string): void {
  registeredTypes.add(type);
}

/** True when a client has registered a spec for this type. */
export function isRegisteredObjectType(type: string): boolean {
  return registeredTypes.has(type);
}
