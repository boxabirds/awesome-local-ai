/**
 * Story 7: the set of object types known to the shared model.
 *
 * `sticky` is a core type defined in the shared model itself (createSticky,
 * STICKY_SIZE_WORLD), so it is known here from module load. The client-side
 * registry (`src/client/objects/registry.tsx`) also calls
 * `registerKnownType` for every type it registers, which is how types added
 * in later stories (9–12) become known to shared operations such as
 * `allObjectIds` (select all) and `snapshot`.
 *
 * The shared model must not import client components, so it consults this
 * set: objects of unregistered types are ignored by generic operations.
 */

const knownTypes = new Set<string>();

knownTypes.add('sticky');
knownTypes.add('shape');
knownTypes.add('connector');
knownTypes.add('stroke');

export function registerKnownType(type: string): void {
  knownTypes.add(type);
}

export function isKnownType(type: string): boolean {
  return knownTypes.has(type);
}
