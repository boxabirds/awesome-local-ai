/**
 * Story 7: the object type registry (sel.registry / sel.all_types).
 *
 * Every board object type declares ONLY its per-type knobs here — whether it
 * can be resized, whether it keeps its proportions, its minimum size, whether
 * it has editable text, and its point hit-test. Selection, move, resize,
 * nudge and delete are generic machinery (board-model + useTransformGesture +
 * useBoardKeys) that works identically for every registered type. Stories
 * 9–12 plug new types in by calling `registerObjectType` and must not add
 * their own selection or transform code.
 */
import type React from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  registerKnownObjectType,
  type ObjectSnapshot,
} from 'src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from 'src/shared/config';
import { StickyNote } from './StickyNote';

/**
 * Common props handed to every registered object component. `onPointerDown`
 * delegates press handling to the generic transform gesture (group move /
 * single-object drag); future types do the same and gain selection, moving
 * and resizing for free.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False when the board is `load_failed`: selectable, never mutable. */
  editable: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  /** May the selection's bounding box show resize handles for this type? */
  resizable: boolean;
  /** While selected, keep the bounding box's width-to-height ratio. */
  aspectLocked: boolean;
  /** Smallest allowed size in board units (feeds clampScale). */
  minSize: number;
  /** May the object's text be edited (Enter / double-click)? */
  editableText: boolean;
  /** Point-in-object hit test (world units). */
  hitTest: (obj: ObjectSnapshot, worldPoint: { x: number; y: number }) => boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Registers an object type. Throws on duplicate registration — a programming
 * error that must fail loudly at module load, not silently in the UI.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  specs.set(type, spec);
  // board-model must be able to select/mutate objects of this type
  // (allObjectIds, select-all, group ops).
  registerKnownObjectType(type);
}

/** The spec for a type, or undefined when the type is not registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/** Sticky-note hit test: the point lies within the note's bounds. */
function stickyHitTest(obj: ObjectSnapshot, p: { x: number; y: number }): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

// The one type this story ships: sticky notes (resizable, always square,
// never smaller than STICKY_MIN_SIZE_WORLD, editable text).
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});
