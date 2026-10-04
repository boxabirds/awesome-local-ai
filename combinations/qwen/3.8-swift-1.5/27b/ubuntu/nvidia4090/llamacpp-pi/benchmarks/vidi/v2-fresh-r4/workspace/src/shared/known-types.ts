/**
 * Tracks which object types have been registered.
 * The client-side registry calls `addKnownType` when registering a type.
 * Board-model uses `isKnownType` to filter snapshots (e.g. for select-all).
 */
const knownTypes = new Set<string>(['sticky', 'text', 'shape', 'connector']);

export function addKnownType(type: string): void {
  knownTypes.add(type);
}

export function isKnownType(type: string): boolean {
  return knownTypes.has(type);
}
