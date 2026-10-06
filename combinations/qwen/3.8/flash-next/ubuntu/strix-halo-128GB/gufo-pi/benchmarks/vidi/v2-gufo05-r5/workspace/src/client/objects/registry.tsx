/**
 * Object type registry (story 7).
 *
 * Each board object type declares its component, whether it can be resized, whether it
 * keeps its proportions, its minimum size, whether it has editable text, and a hit-test.
 * Selection, move, resize, nudge and delete are generic (sel.all_types): a new type only
 * calls `registerObjectType` with its spec.
 */
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

export interface ObjectTypeSpec {
  /** React component that renders this object type (set during app initialization). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: any;
  /** Whether the object can be resized via handles. */
  resizable: boolean;
  /** Whether width-to-height ratio is locked during resize. */
  aspectLocked: boolean;
  /** Minimum width/height in world units. */
  minSize: number;
  /** Whether the object has inline text editing. */
  editableText: boolean;
  /** Hit-test: is `worldPoint` inside this object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Registers a new object type. Throws if the type string is already registered.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Returns the spec for the given type, or undefined if not registered.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---- Hit-test helpers ----

/** Hit test for any rectangular object: point within objectBounds. */
export function rectHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// ---- Register built-in types ----

registerObjectType('sticky', {
  Component: null, // set by registerStickyComponent() at app startup
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});
