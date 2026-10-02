/**
 * Object type registry (story 7, sel.registry).
 *
 * Each board object type declares only its render component and resize rules
 * (resizable, aspectLocked, minSize, editableText, hitTest). Selection, move,
 * resize, nudge and delete behaviour stays generic (sel.all_types).
 */

import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { registerObjectTypeKey } from '../../shared/object-types';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/** Props every object component receives from the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Native pointerdown on the object (delegates to the transform gesture). */
  onPointerDown: (e: PointerEvent, id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming
 * error, caught by the registry unit tests). Also marks the type as known to
 * the shared board model so `snapshot()` renders it.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerObjectTypeKey(type);
}

/** The spec for `type`, or undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---------------------------------------------------------------------------
// Story 2 type: the sticky note (resizable, aspect-locked, minSize 50).
// ---------------------------------------------------------------------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
