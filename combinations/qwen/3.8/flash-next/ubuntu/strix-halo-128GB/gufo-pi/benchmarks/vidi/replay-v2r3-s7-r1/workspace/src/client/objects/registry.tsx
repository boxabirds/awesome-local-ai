import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import type { StickyColor } from '../../shared/config';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

/**
 * Props that every board object component receives. The generic transform
 * gesture, selection overlay, and marquee all use these (sel.all_types).
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  onDoubleClick(e: React.MouseEvent<HTMLDivElement>, id: string): void;
}

/**
 * Declarative spec for a registered board object type.
 * Each type may declare only: resizable, aspectLocked, minSize, editableText,
 * and a hitTest function. Selection, move, resize and delete stay generic.
 */
export interface ObjectTypeSpec {
  Component: React.ComponentType<any>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Look up an object type spec. Returns undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---------- Register built-in types ----------

/** Sticky note hit test: world point within object bounds. */
function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// Import here to avoid circular dependency issues at module load time.
// StickyNote is imported lazily via require pattern to allow the registry to
// be tested in node (unit) environment without rendering.
import { StickyNote } from './StickyNote';

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});
