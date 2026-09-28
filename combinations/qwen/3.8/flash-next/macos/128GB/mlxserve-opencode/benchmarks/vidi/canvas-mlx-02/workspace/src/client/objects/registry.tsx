// The object-type registry (story 7, sel.registry).
//
// One entry per board object type, declaring the ONLY per-type knobs the
// generic selection / move / resize / delete machinery needs: whether the type
// can be resized, whether it keeps its proportions, its minimum size, whether
// it has editable text, and how to hit-test a world point against it.
//
// Stories 9-12 add types here and must NOT add their own selection, move,
// resize or delete code (sel.all_types): the machinery in useSelection,
// useTransformGesture, SelectionOverlay, Marquee and useBoardKeys is the same
// for every type and reads only this spec.
import type React from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model.ts';
import { registerReadableType } from '../../shared/board-model.ts';
import type { Point } from '../../shared/geometry.ts';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config.ts';
import { StickyNote } from './StickyNote.tsx';
import { TextObject } from './TextObject.tsx';
import type { EndMode } from '../board/useSelection.ts';

// The props every board object component receives. Selection, dragging and
// resizing are wired through the generic callbacks; a type owns only its own
// rendering and its per-type behaviour behind these.
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** false while the board cannot be mutated at all (story 4 load failure) */
  editable: boolean;
  /** grab to move the selection; selects the object first when unselected */
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndMode): void;
  /** sticky-only: change the note colour (a no-op surface for other types) */
  onColor(id: string, color: string): void;
}

// Re-exported type note: Y is imported type-only above.

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /**
   * Which SelectionOverlay handles the type gets. 'all' (the default) is the
   * eight-direction box; 'horizontal' is the two side handles of a type whose
   * HEIGHT is computed by its layout and must never be dragged (story 9).
   */
  handles?: 'all' | 'horizontal';
}

const registry = new Map<string, ObjectTypeSpec>();

// Register a board object type. A duplicate registration is a programming
// error and throws at module load (caught by TC); one registration also marks
// the type readable in the board model, so stories 9-12 register once.
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type === '') {
    throw new Error('registerObjectType requires a non-empty type name');
  }
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerReadableType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// The sticky note (story 2) becomes the first registered type: resizable, and
// always square (aspectLocked), with the product minimum size.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj: ObjectSnapshot, point: Point): boolean {
    const w = obj.width ?? STICKY_SIZE_WORLD;
    const h = obj.height ?? STICKY_SIZE_WORLD;
    return point.x >= obj.x && point.x <= obj.x + w && point.y >= obj.y && point.y <= obj.y + h;
  },
});

// The free text (story 9) is the second registered type: resizable only side-
// ways, because its height is computed by the layout, never dragged. The
// generic machinery reads exactly this and owns the text's selection, moving,
// resizing and deleting - story 9 adds none of it.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj: ObjectSnapshot, point: Point): boolean {
    const w = obj.width ?? TEXT_MIN_WIDTH_WORLD;
    const h = obj.height ?? 0;
    return point.x >= obj.x && point.x <= obj.x + w && point.y >= obj.y && point.y <= obj.y + h;
  },
});
