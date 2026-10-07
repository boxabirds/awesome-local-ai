import * as Y from 'yjs';
import type { ComponentType } from 'react';

import {
  isKnownObjectType,
  objectBounds,
  registerBoardObjectType,
  type ObjectSnapshot,
  type Rect,
} from '../../shared/board-model.js';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config.js';
import { TEXT_TYPE } from '../../shared/objects/text.js';
import { SHAPE_TYPE } from '../../shared/objects/shape.js';
import { CONNECTOR_TYPE, type ConnectorSnap } from '../../shared/objects/connector.js';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry.js';
import { distanceToPolyline } from '../../shared/geometry/polyline.js';
import type { Camera } from '../canvas/camera.js';
import type { TransformGesture } from '../board/useTransformGesture.js';
import type { UndoController } from '../board/undo.js';
import type { UseSelectionResult } from '../board/useSelection.js';
import StickyNote from './StickyNote.js';
import TextObject, { resizeTextObject } from './TextObject.js';
import ShapeObject from './ShapeObject.js';
import ConnectorObject from './ConnectorObject.js';

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
  /** This tab's own undo history (story 8), handed to every object type alike. It
   * is the same controller whichever object is being drawn - undo is a property of
   * the board and the person using it, not of the object - and an object that can
   * change the document uses it to say where one action stops and the next starts.
   * Optional so an object can be drawn by a test, or a board, that keeps no history.
   */
  undo?: UndoController;
  /**
   * Every other object's live rectangle, keyed by id (`connector.follow`).
   *
   * An arrow's geometry is a question about two other objects, so it cannot be drawn
   * from its own snapshot alone. The board has the rectangles already - the selection
   * outline is drawn from them - and computing them once here keeps every object
   * looking at the same set, which is what makes an arrow and the box it points at
   * agree on one screen. A type that draws only itself never asks.
   */
  rects?: ReadonlyMap<string, Rect>;
  /**
   * The whole board, for a type that has to know what else is under the pointer -
   * an arrow's end being dragged to a new object, and nothing else so far.
   */
  snapshot?: readonly ObjectSnapshot[];
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
  /** Whether a point (world units) is inside it; the default hit test.
   *
   * `zoom` and `rects` are there for the one type that is not a box: an arrow is
   * found by how near its *line* the point is, which needs the zoom to turn screen
   * pixels into board units and the live rectangles to know where that line is. A
   * type that is a box ignores both.
   */
  hitTest?(object: ObjectSnapshot, point: { x: number; y: number }, zoom?: number, rects?: ReadonlyMap<string, Rect>): boolean;
  /**
   * Which of the eight handles this type is resized by. `'all'` (the default, and
   * what a shape that keeps its proportions is drawn with) shows the whole set;
   * `'horizontal'` shows only the two side handles, for a type whose height is not
   * its own to keep - a piece of text is as tall as the lines it needs at the width
   * it has, so dragging a corner and getting a stretched height would be a lie
   * about what the box contains.
   *
   * The selection asks this of *every* object in it and only shows the smaller set
   * when all of them agree; a text next to a note is resized as a group, by the
   * full set (`text.mixed_handles`).
   */
  handles?: HandleSet;
  /**
   * Write one handle drag to one object of this type, for a type where the
   * rectangle the pointer described is not simply the object's new rectangle. The
   * default is `resizeObjects`: width and height, as drawn. A text object instead
   * adopts the width - or ignores it, if its width is still its own - and takes its
   * height from the measurement of the lines that width produces.
   *
   * `sole` is whether this object is the whole selection: the only way a drag can
   * mean "this wide" rather than "scaled along with the others".
   */
  resizeTo?(doc: Y.Doc, id: string, rect: Rect, sole: boolean): boolean;
}

/** Which handles a type is resized by. */
export type HandleSet = 'all' | 'horizontal';

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

/** No rectangles to ask: an attached end is drawn at the point it kept. */
const NO_RECTS: ReadonlyMap<string, Rect> = new Map<string, Rect>();

/**
 * How near an arrow's line a point has to be to be on the arrow (`connector.select`):
 * `CONNECTOR_HIT_TOLERANCE_PX` *screen* pixels, divided by the zoom to get board
 * units, so the arrow is as easy to hit at 400% as at 40% and a click inside the box
 * but far from the line is not a click on the arrow at all.
 */
export function connectorHitTest(
  object: ObjectSnapshot,
  point: { x: number; y: number },
  zoom = 1,
  rects: ReadonlyMap<string, Rect> = NO_RECTS,
): boolean {
  const connector = object as ConnectorSnap;
  const ends = resolveEndpoints({ from: connector.from, to: connector.to }, rects);
  return distanceToPolyline([ends.from, ends.to], point) <= CONNECTOR_HIT_TOLERANCE_PX / (zoom || 1);
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

// Story 9's text. Resizable, never aspect-locked (its height is a measurement, not
// a proportion), editable, and resizable only sideways. `minSize` is the narrowest
// column of text a handle may drag it into.
registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: squareHitTest,
  resizeTo: resizeTextObject,
});

// Story 10's shapes. Resizable, never aspect-locked (a shape is as square as the
// drag that made it, and a Shift held *while drawing* is the only thing that makes
// one square again), editable text in the middle, and hit as a box - the figure is
// drawn inside the box, so a click in the corner of a diamond's box is a click on
// the diamond's neighbourhood, which is what a box-shaped board means.
registerObjectType(SHAPE_TYPE, {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: squareHitTest,
});

// Story 10's arrows. Not resizable: an arrow has no box of its own to resize, only
// two ends, which are moved by their own handles. No editable text, and hit by its
// line rather than by its box - see `connectorHitTest`.
registerObjectType(CONNECTOR_TYPE, {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: connectorHitTest,
});

export { isKnownObjectType };
export type { Camera };
