// Object type registry (story 7, sel.registry). Each board object type declares
// only how it renders and whether/how it can be resized; selection, move,
// resize, nudge and delete stay generic (sel.all_types).
import type { ComponentType, PointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerModelType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { TEXT_TYPE } from '../../shared/objects/text';
import { StickyNote } from './StickyNote';
import { resizeText, TextObject } from './TextObject';

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
  /** Which resize handles a selection of only this type shows (default 'all'; story 9). */
  handles?: 'all' | 'horizontal';
  /**
   * Writes a resize frame for this type instead of the generic width/height
   * write: `next` is the object's rect in the transformed selection, `start`
   * its rect when the gesture began; `horizontalOnly` when every selected
   * object has horizontal handles. Called inside the frame's transaction.
   */
  resize?(doc: Y.Doc, id: string, next: Rect, start: Rect, horizontalOnly: boolean): void;
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

registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  resize: resizeText,
  hitTest: boundsHitTest,
});
