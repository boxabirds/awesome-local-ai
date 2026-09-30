/**
 * Story 7: object type registry.
 *
 * Every board object type declares ONLY its rendering component and a few
 * per-type rules: whether it can be resized, whether it keeps its
 * proportions, and its minimum size (PRD sel.all_types). Selection, move,
 * resize, nudge and delete stay generic in board-model and the transform
 * gesture. Stories 9–12 register their types here and must not add their own
 * selection or transform code.
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '@shared/board-model';
import type { Point } from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';
import { registerKnownType } from '@shared/known-types';
import { StickyNote } from './StickyNote';

/** Props handed to every object component by the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Generic transform-gesture entry point (drag to move the selection). */
  onObjectPointerDown: (e: ReactPointerEvent, id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  /** Story 8: undo boundary (close capture window). */
  onUndoBoundary?: () => void;
  /** Story 8: undo the last step (for in-editor Ctrl+Z). */
  onUndo?: () => void;
  /** Story 8: redo the last step (for in-editor Ctrl+Shift+Z). */
  onRedo?: () => void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/** Register a type. Throws on duplicate registration (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type '${type}' is already registered`);
  }
  specs.set(type, spec);
  registerKnownType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});
