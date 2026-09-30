// Object type registry (story 7, sel.registry). Each board object type declares
// only how it renders and whether/how it can be resized; selection, move,
// resize, nudge and delete stay generic (sel.all_types).
import type { ComponentType, PointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerModelType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';

/** This object's part in the local transform gesture. */
export type ObjectGesturePhase = 'idle' | 'pressed' | 'dragging';

/** Props every registered object component receives from the board. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** Stacking position among rendered objects (render order stays stable during drags). */
  zIndex: number;
  selected: boolean;
  editing: boolean;
  /** No moving, resizing or editing (the board could not be loaded, story 4). */
  readOnly: boolean;
  gesture: ObjectGesturePhase;
  /** Every object delegates its pointerdown here (useTransformGesture). */
  onPointerDown(e: PointerEvent<Element>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest width and height in world units. */
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const types = new Map<string, ObjectTypeSpec>();

/** Registers a type at module load. Registering the same type twice is a programming error. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`Object type "${type}" is already registered`);
  types.set(type, spec);
  registerModelType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

/** True when the point lies within the object's rect (edges included). */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  return rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 });
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});
