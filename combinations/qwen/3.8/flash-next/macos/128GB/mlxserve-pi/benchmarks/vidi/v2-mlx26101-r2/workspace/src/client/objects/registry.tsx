import * as Y from 'yjs';
import type { ComponentType } from 'react';

import {
  isKnownObjectType,
  objectBounds,
  registerBoardObjectType,
  type ObjectSnapshot,
} from '../../shared/board-model.js';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config.js';
import type { Camera } from '../canvas/camera.js';
import type { TransformGesture } from '../board/useTransformGesture.js';
import type { UseSelectionResult } from '../board/useSelection.js';
import StickyNote from './StickyNote.js';

/**
 * The object type registry (story 7, `src/client/objects/registry.tsx`).
 *
 * Story 7 is the first story where the board holds more than one kind of thing,
 * and several behaviours are per-type rather than global: whether an object can
 * be resized by a handle, whether it keeps its proportions while it is resized,
 * how small it may go, and whether it has editable text. This module owns those
 * answers and the component that draws each type, so adding a shape or an image
 * later (stories 9-12) is "call `registerObjectType` once at start-up" rather
 * than editing every selection/marquee/toolbar file.
 *
 * A registered type is also registered with the document model
 * (`registerBoardObjectType`), so the two never disagree about what a valid type
 * is - group operations, which read the document, accept exactly the types the
 * client knows how to draw.
 */

/** Everything the board renderer hands an object component to draw it. */
export interface ObjectProps {
  /** The object's snapshot (position, size, type, plus type-specific fields). */
  object: ObjectSnapshot;
  /** The shared document, for the mutations the object itself can make. */
  doc: Y.Doc;
  /** Current zoom, for the constant-screen-size chrome. */
  zoom: number;
  /** Whether this object is in the selection. */
  selected: boolean;
  /** Whether this object's text editor is open. */
  editing: boolean;
  /** False when the document cannot be changed; drops the editable affordances. */
  canEdit: boolean;
  /** How many objects are selected (a note shows its toolbar only when alone). */
  selectionSize: number;
  /** The shared selection controller. */
  selection: UseSelectionResult;
  /** The shared move/resize gesture controller. */
  gesture: TransformGesture;
}

/**
 * How the board draws one object type and how selection behaves for it. The three
 * resize fields exist precisely so the selection overlay never has to ask "is
 * this a sticky note?": it asks the type.
 */
export interface ObjectTypeSpec {
  /** The component that draws it. */
  Component: ComponentType<ObjectProps>;
  /** Whether the selection offers resize handles for it at all. */
  resizable: boolean;
  /** Whether the aspect ratio is kept while resizing (a square stays square). */
  aspectLocked: boolean;
  /** The smallest width and height, in world units. */
  minSize: number;
  /** Whether it has editable text (so Enter and the toolbar pencil apply). */
  editableText: boolean;
  /** Whether a point (world units) is inside it; the default hit test. */
  hitTest?(object: ObjectSnapshot, point: { x: number; y: number }): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Called once per type at start-up; a second
 * registration of the same key is a programming mistake (two files claiming one
 * type), so it throws rather than silently picking a winner. Every registration
 * also tells the document model the type is valid, so the client and the document
 * always agree on what can be drawn and moved.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`objects: object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  registerBoardObjectType(type);
}

/** The spec for a type, or `undefined` for a type this build cannot draw. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The registered type names. */
export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}

/** A plain square hit test, in world units (falls back to the drawn size). */
function squareHitTest(object: ObjectSnapshot, point: { x: number; y: number }): boolean {
  const rect = objectBounds(object);
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// The one object type story 7 ships with. Resizable, aspect-locked, editable.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: squareHitTest,
});

export { isKnownObjectType };
export type { Camera };
