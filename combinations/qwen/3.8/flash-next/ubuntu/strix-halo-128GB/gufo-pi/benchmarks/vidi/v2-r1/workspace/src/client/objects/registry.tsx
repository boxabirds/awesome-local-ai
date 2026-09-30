/**
 * Object type registry: each board object type declares its component,
 * resizability, aspect lock, minimum size, text editability and hit-test.
 * Stories 9-12 add new types here without duplicating selection/transform code.
 */

import type { ObjectSnapshot, Point } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

export interface ObjectTypeSpec {
  Component: React.ComponentType<any> | null;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Hit test: world point falls within the object's bounds. */
function boundsHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.y >= bounds.y &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// Register the sticky type at module load.
// The Component field is set by App.tsx via setComponent() once the actual
// StickyNote component is available (avoids circular imports).
registerObjectType('sticky', {
  Component: null,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

/** Set the Component for an already-registered type (used by the app for lazy binding). */
export function setObjectComponent(type: string, Component: React.ComponentType<any>): void {
  const spec = registry.get(type);
  if (spec) spec.Component = Component;
}
