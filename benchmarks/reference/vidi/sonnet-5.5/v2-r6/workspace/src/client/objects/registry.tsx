import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerSelectableType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** What every board object component receives; selection, moving and resizing stay outside the component. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  readOnly: boolean;
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** The only per-type knobs: selection, move, resize and delete are generic. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Which resize handles a selection of this type shows; default 'all'. */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const types = new Map<string, ObjectTypeSpec>();

/** Throws on a duplicate registration (a programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`object type already registered: ${type}`);
  types.set(type, spec);
  registerSelectableType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

const insideBounds = (obj: ObjectSnapshot, p: Point): boolean => {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
};

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: insideBounds,
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: insideBounds,
});
