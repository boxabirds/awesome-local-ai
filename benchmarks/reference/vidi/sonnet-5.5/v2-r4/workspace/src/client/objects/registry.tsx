import type * as Y from 'yjs';
import { objectBounds, registerKnownType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { PointerLike } from '../board/useTransformGesture';
import type { Point } from '../canvas/camera';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** Everything the board hands to an object's component; selection, moving and resizing stay generic. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** False while the board is not loaded: no drag, edit, colour or delete. */
  editable: boolean;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Call from the component's pointerdown; starts selection and the move gesture. */
  onObjectPointerDown(e: PointerLike, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** The only per-type knobs: whether it resizes, keeps its proportions, and its minimum size. */
export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Handles shown when every selected object is of a 'horizontal' type; default 'all'. */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const types = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`object type already registered: ${type}`);
  types.set(type, spec);
  registerKnownType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

export const boundsHitTest: ObjectTypeSpec['hitTest'] = (obj, p) => {
  const b = objectBounds(obj);
  return p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height;
};

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boundsHitTest,
});
