/**
 * The set of object types this build knows how to select/move/resize/delete
 * (story 7, sel.all_types).
 *
 * Story 10 moved this out of board-model into its own dependency-free
 * module: board-model imports the connector model (to detach orphaned
 * connector ends on delete), and the connector model marks its type known
 * at module scope — if the set lived in board-model that call would run
 * against a not-yet-initialized binding (ESM circular-import TDZ).
 */
const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set(['sticky']);

/**
 * Registers an object type as known (call from the shared model module,
 * e.g. `registerKnownObjectType('shape')` in objects/shape.ts).
 */
export function registerKnownObjectType(type: string): void {
  (KNOWN_OBJECT_TYPES as Set<string>).add(type);
}

/** True when the type is known to the build (else the op is a no-op). */
export function isKnownObjectType(type: string): boolean {
  return KNOWN_OBJECT_TYPES.has(type);
}
