// The object-type registry (story 7).
//
// Every kind of board object — sticky notes today, text/shapes/drawings/images in
// stories 9-12 — registers one `ObjectTypeSpec` here. The spec carries the *only*
// per-type knobs the generic selection, move, resize, nudge and delete machinery
// is allowed to care about: which component renders it, whether it can be resized,
// whether it keeps its proportions, its minimum size, whether it edits text, and
// how to hit-test a point. A new type must NOT add its own selection or transform
// code (sel.all_types); it declares these values and reuses everything else.

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import type { ConnectorEnd } from '../../shared/objects/connector';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { connectorPolyline, distanceToPolyline } from '../../shared/geometry';
import type { Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import type { ConnectorSnap } from '../../shared/objects/connector';

/**
 * The props every board object component receives. The object's own data is
 * `obj` (a component narrows it to its type's snapshot); selection, editing and
 * the transform gesture are handed down as callbacks so the object never owns
 * selection or drag logic itself. `onColor` / `onDelete` are used by a single
 * selected object's own toolbar (the sticky note's colour + bin).
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  /**
   * The live camera, for the screen-sized chrome an object draws itself (an arrow's dots
   * and handles). Optional because nothing that existed before story 10 needs it.
   */
  camera?: Camera;
  /** This object is one of several selected. */
  selected: boolean;
  /** This object is the *only* selected object (its own toolbar is shown). */
  sole: boolean;
  editing: boolean;
  canEdit: boolean;
  /** Press on the object body: select / begin a move (useTransformGesture). */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onColor(id: string, color: string): void;
  /**
   * Paint this object's fill and/or outline (shape.style), in one call and so in one
   * transaction. Only a shape has anything to paint, so only ShapeObject calls it.
   */
  onStyle?(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
  onDelete(id: string): void;
  /**
   * Press on one of a selected arrow's end handles (connector.handles). Deliberately not
   * `onObjectPointerDown`: dragging an end moves that end and not the arrow, so this press
   * must never reach the generic transform gesture.
   */
  onConnectorEndPointerDown?(e: ReactPointerEvent<Element>, id: string, end: ConnectorEnd): void;
}

/**
 * Which resize handles a type offers. 'all' is the eight handles of stories 1-8;
 * 'horizontal' (free text) offers only the east / west side handles, because a text
 * object's height always follows its content and can never be dragged (text.fixed_width).
 */
export type Handles = 'all' | 'horizontal';

/** Everything the generic machinery needs to know about one object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Whether a resize handle changes this type's size at all. */
  resizable: boolean;
  /** Whether the type always keeps its width-to-height ratio (sticky notes). */
  aspectLocked: boolean;
  /** The smallest side this type may be resized to, in world units. */
  minSize: number;
  editableText: boolean;
  /** Which handles to show; omitted means 'all' (every type before story 9). */
  handles?: Handles;
  /** Does `worldPoint` fall inside this object?
   *
   * `zoom` is optional because the board units a gesture is written in are already the
   * caller's business; it is here for the types whose hit area is a *screen* allowance. An
   * arrow is six screen pixels wide whichever way the board is zoomed, so its rule cannot
   * say anything true without knowing the zoom (connector.select, TC-20).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type. A duplicate registration is a programming error (two modules
 * claiming one type name) and throws at module-load / registration time so it is
 * caught by a test rather than silently shadowing a component.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or undefined for a type nothing has registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * The handles a type offers. Anything unregistered or registered without an explicit
 * `handles` gets 'all', so the story 1-8 types are untouched by this field.
 */
export function getHandles(type: string): Handles {
  return registry.get(type)?.handles ?? 'all';
}

/** A rectangle hit-test: the same rule for every axis-aligned object type. */
function rectHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const b = objectBounds(obj);
  return (
    worldPoint.x >= b.x &&
    worldPoint.x <= b.x + b.width &&
    worldPoint.y >= b.y &&
    worldPoint.y <= b.y + b.height
  );
}

// The one real object type so far. Stories 9-12 add theirs with their own
// registerObjectType call and no other selection/transform code.
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

// Free text (story 9): resizable only sideways, never aspect-locked (its height is
// derived from its content), editable, and it selects / moves / deletes through the
// same generic machinery as a sticky note (text.consistent).
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: rectHitTest,
});

// A shape (story 10) is an ordinary object: aspect-locked like a note, so a corner drag
// keeps its proportion, and it carries a text label — which is why `editableText` is
// true and the board's generic Enter-to-edit opens its label (shape.consistent, shape.label).
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: true,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

// An arrow (story 10) is the one object that is not resized and has no text: its box is
// whatever its two ends are doing, and its own handles move those ends instead of the
// shape of a box. Everything else about it — selection, marquee, move, delete, undo — is
// the machinery stories 7 and 8 already had (connector.consistent).
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: CONNECTOR_MIN_LENGTH_WORLD,
  editableText: false,
  // A rectangle would be wrong here: most of an arrow's box is empty board, and most of
  // that does not belong to the arrow. What belongs to it is the line and a screen
  // allowance either side (connector.select).
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean {
    const line = connectorPolyline((obj as ConnectorSnap).endpoints);
    if (line.length < 2) return false;
    // What a person has to hit is the arrow and not a hairline. The tolerance is a screen
    // allowance, so it becomes board units at the zoom the board is at: the same number of
    // pixels on the screen at 50% as at 200%. With no zoom given the board is taken to be
    // at 100%, which is the one reading that is true of the number on its own.
    const z = Number.isFinite(zoom) && (zoom as number) > 0 ? (zoom as number) : 1;
    return distanceToPolyline(line, worldPoint) <= CONNECTOR_HIT_TOLERANCE_PX / z;
  },
});
