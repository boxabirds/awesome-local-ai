import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds, registerKnownObjectType } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * Story 7: the object-type registry.
 *
 * Every board object type declares exactly three behaviours — whether it can
 * be resized, whether it keeps its proportions, and its minimum size
 * (sel.all_types). Selection, moving, resizing, nudging and deleting stay
 * generic in the board machinery; a new type (stories 9–12) only calls
 * `registerObjectType` and provides a render component — it must not add its
 * own selection or transform code.
 */

/** Props handed to every object render component. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  selected: boolean;
  editing: boolean;
  /** Generic transform gesture entry point (move / shift-click toggle). */
  onPointerDown: (e: PointerEvent) => void;
  onStartEdit: () => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Whether the type can be resized at all (handles are hidden otherwise). */
  resizable: boolean;
  /** Whether the type keeps its proportions while resizing (stickies: square). */
  aspectLocked: boolean;
  /** Minimum size in board units (the global maximum is MAX_OBJECT_SIZE_WORLD). */
  minSize: number;
  /** Whether the type has editable text (Enter-to-edit applies). */
  editableText: boolean;
  /** Whether the world point hits the object. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a board object type. Throws on duplicate registration (a
 * programming error, caught by the unit tests). Also marks the type as known
 * to the board model so select-all and snapshots include it.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType '${type}' is already registered`);
  }
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** The spec for `type`, or undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Points-within-bounds hit test shared by bounding-box based types. */
export function boundsHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const b = objectBounds(obj);
  return worldPoint.x >= b.x && worldPoint.x < b.x + b.width && worldPoint.y >= b.y && worldPoint.y < b.y + b.height;
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});
