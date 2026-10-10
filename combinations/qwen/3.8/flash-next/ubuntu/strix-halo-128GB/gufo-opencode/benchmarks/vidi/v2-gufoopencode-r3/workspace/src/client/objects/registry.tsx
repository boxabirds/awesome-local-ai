import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerSelectableType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import type { UndoController } from '../board/undo';
import type { EndEditNext } from '../board/useSelection';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

// The props every object component receives. Position, size and selection
// behaviour are generic; per-type specifics live in the document and in the
// spec below.
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  // False while the board cannot be mutated (load_failed): no gestures (TC-23).
  editable: boolean;
  // Press on the object body: selection + group move gesture, owned by the
  // board (the component must stopPropagation so the viewport does not pan).
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  // This tab's undo history, for components that own keyboard input while
  // editing (the sticky text editor routes Ctrl/Cmd+Z to it).
  undo?: UndoController;
}

// The only per-type knobs. Selection, move, resize, delete, keyboard and the
// marquee are all generic over registered types (sel.all_types).
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  // 'horizontal' = only e/w handles (height is derived, story 9 text).
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, point: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    // Programming error: two modules claiming one type name.
    throw new Error(`registerObjectType: type "${type}" is already registered`);
  }
  registry.set(type, spec);
  registerSelectableType(type);
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
  hitTest: (obj, point) =>
    rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, point) =>
    rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
});
