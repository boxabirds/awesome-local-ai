// Object-type registry: the only place that knows which types exist and what
// they can do (stories 9-12 plug in here and must not add their own
// selection or transform code). Module-level map populated at import.

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { markTypeKnown, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

// Props every registered object component receives from the board renderer;
// pointerdown delegates to useTransformGesture so all types share one
// selection + transform pipeline.
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  undo?: UndoController;
  onObjectPointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  // 'horizontal' restricts resize handles to e/w (story 9 text: only width is
  // user-controlled, height belongs to the layout).
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

// Throws on duplicate registration (programming error, caught by tests).
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  markTypeKnown(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, worldPoint) =>
    rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 }),
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, worldPoint) =>
    rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 }),
});
