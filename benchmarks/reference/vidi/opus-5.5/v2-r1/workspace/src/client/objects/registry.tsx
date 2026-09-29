// Object type registry (story 7). Selection, moving, resizing and deleting are generic; a type
// declares only its component, whether it can be resized, whether it keeps its proportions, its
// minimum size, whether it holds editable text, and how to hit-test it. Stories 9–12 register
// their types here and add no selection or transform code of their own.
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { type ObjectSnapshot, objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';

/** Props the board passes to every object component. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board is locked (story 4): no move, resize, edit or delete. */
  editable: boolean;
  /** True while a move or resize gesture of the selection is in progress. */
  transforming: boolean;
  /** CSS stacking layer: the object's rank in (z, id) order. */
  layer?: number;
  /** Starts the generic select / move gesture (useTransformGesture). */
  onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus selected the object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest width and height, world units. */
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers a type; registering the same type twice is a programming error and throws. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

export function isRegisteredType(type: string): boolean {
  return registry.has(type);
}

/** Point-in-bounds hit test (edges included). */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});
