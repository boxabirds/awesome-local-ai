// Object type registry (story 7, sel.registry contract): every object type
// declares how it renders and how the generic selection and transform
// machinery may operate on it. Later object types (stories 9–12) register
// here and inherit selection, group move, resize and delete without adding
// their own interaction code (sel.all_types).

import type React from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { pointInRect, type Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';

/**
 * The minimal pointer-event shape the object components and the transform
 * gesture exchange. Both a native `PointerEvent` and React's synthetic
 * `PointerEvent` satisfy it structurally.
 */
export interface ObjectPointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly shiftKey: boolean;
}

/**
 * Props every registered object component receives from the board. The
 * component renders its object in world coordinates and delegates pointer
 * input to the generic transform gesture via `onPointerDown`.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom (screen px per world unit). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Story 4 edit lock: while false the object can still be selected, but
   * move/resize and entering edit mode are no-ops.
   */
  canEdit: boolean;
  /** Delegate a pointerdown on this object to the transform gesture. */
  onPointerDown(e: ObjectPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /**
   * End editing. `'selected'` keeps the object selected (Escape);
   * `'unselected'` clears the selection (click outside).
   */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * Story 8: the per-board undo controller. Optional so existing harnesses
   * (and future non-undo features) keep working; objects with editable text
   * use it for typing boundaries and in-editor undo/redo.
   */
  undo?: UndoController;
}

/**
 * What one object type declares about itself. A type may declare only
 * whether it can be resized, whether it keeps its proportions, its minimum
 * size and how it is hit-tested — nothing else (sel.all_types).
 */
export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Minimum side length in world units (the maximum is global). */
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error that must surface at module load, caught by the unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`Object type already registered: ${type}`);
  }
  specs.set(type, spec);
  registerKnownObjectType(type);
}

/** The spec for `type`, or undefined for types this build does not know. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

// --- Sticky notes (story 2, moved onto the generic machinery) ---------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true, // sticky notes stay square
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => pointInRect(objectBounds(obj), p),
});
