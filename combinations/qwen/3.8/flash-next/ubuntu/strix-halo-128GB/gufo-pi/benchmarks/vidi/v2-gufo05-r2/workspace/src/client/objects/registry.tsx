import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * Everything the board needs to know about one kind of object.
 *
 * Story 7's selection, moving, resizing and deleting are generic: a type declares
 * only whether it can be resized, whether it keeps its proportions, how small it
 * may go, whether it holds editable text, and how to tell a point inside it from
 * a point outside it. A story that adds a type registers one of these in its own
 * file and writes no interaction code (design key decision 5).
 */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while this page may not change the board (story 4's `canEdit`). */
  editable: boolean;
  /** Selection, group move and the drag threshold: see `useTransformGesture`. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: { x: number; y: number }): boolean;
}

const types = new Map<string, ObjectTypeSpec>();

/**
 * Declare an object type. Registering the same type twice is a programming error
 * — two specs for one type would make the second one's behaviour unreachable, so
 * it throws rather than silently disagreeing with itself.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`object type "${type}" is already registered`);
  types.set(type, spec);
}

/** The spec for `type`, or undefined when this client cannot draw it at all. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

/** True for every type this client can draw and therefore select. */
export function isSelectableObjectType(type: string): boolean {
  return types.has(type);
}

/** A rectangle's own hit test: the box, edges included. */
function boxHitTest(obj: ObjectSnapshot, worldPoint: { x: number; y: number }): boolean {
  const box = objectBounds(obj);
  return (
    worldPoint.x >= box.x &&
    worldPoint.x <= box.x + box.width &&
    worldPoint.y >= box.y &&
    worldPoint.y <= box.y + box.height
  );
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  // A sticky note is square (PRD 7.3), so its resize keeps the proportions.
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boxHitTest,
});
