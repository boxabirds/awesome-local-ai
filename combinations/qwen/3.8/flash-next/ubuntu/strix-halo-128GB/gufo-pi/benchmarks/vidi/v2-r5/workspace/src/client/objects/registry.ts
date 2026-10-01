/**
 * Object type registry: a module-level Map declaring per-type behaviour for selection,
 * move, resize and delete. Stories 9–12 call `registerObjectType` to add new types;
 * they must NOT add their own selection or transform code.
 *
 * A type declares only: whether it can be resized, whether it keeps its proportions,
 * its minimum size, whether it has editable text, and a hitTest.
 */

import type { Point } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';

export interface ObjectTypeSpec {
  /** React component for rendering this type. */
  Component: React.ComponentType<any>;
  /** Whether this type supports resize handles. */
  resizable: boolean;
  /** Whether the aspect ratio is locked (e.g. sticky notes stay square). */
  aspectLocked: boolean;
  /** Minimum size in world units (both axes cannot go below this). */
  minSize: number;
  /** Whether this type has editable text. */
  editableText: boolean;
  /** Hit test: is `worldPoint` inside the object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a new object type. Throws on duplicate registration (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Get the spec for a registered type, or undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Default hit test: worldPoint is inside the object's bounds. */
export function defaultHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}
