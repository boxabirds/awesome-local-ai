/**
 * Object type registry (story 7, sel.registry).
 *
 * Every object type registers one spec here. Selection, move, resize and
 * delete stay generic (sel.all_types); the spec only carries the per-type
 * knobs: the renderer component, resizability, the aspect lock, the minimum
 * size, whether the text is editable, and the hit test.
 *
 * Selection state is never written to the Y.Doc (sel.interaction contract).
 */
import * as Y from 'yjs';
import type { ComponentType } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { addKnownObjectType, objectBounds } from '../../shared/board-model';
import type { Camera, Point } from '../canvas/camera';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { moveObjects } from '../../shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { getTextWidthMode, setTextWidthFixed } from '../../shared/objects/text';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';

/**
 * Structural pointer event: satisfied by both React synthetic pointer events
 * and native PointerEvents.
 */
export interface GesturePointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly shiftKey: boolean;
  readonly button?: number;
  readonly pointerType?: string;
  stopPropagation(): void;
}

/**
 * Props every object component receives (sel.all_types). Objects only
 * report; the board owns selection, gestures and editing.
 */
export interface ObjectProps {
  doc: Y.Doc;
  obj: ObjectSnapshot;
  /** True when this object is in the current selection. */
  selected: boolean;
  /** The object currently in text editing mode (null when none). */
  editingId: string | null;
  /** Pointerdown on this object: the board routes it to selection + gesture. */
  onPointerDown(e: GesturePointerEvent, id: string): void;
  /** Double-click: start editing this object (only when the spec allows). */
  onEdit(id: string): void;
  /** End text editing: 'selected' (Escape) or 'unselected' (outside press). */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * Close the undo capture window when text editing starts/ends (story 8,
   * undo.boundaries); optional so types without editable text need not care.
   */
  onTextBoundary?(): void;
  /** Ctrl/Cmd+Z inside the text editor: undo this tab's last step (story 8). */
  onTextUndo?(): void;
  /** Wraps one discrete user action in an undo boundary (story 10: the
   *  connector's re-attach commit is one undo step). */
  onBoundary?(): void;
  /**
   * Story 9: while the Text tool is active every object is inert (no
   * pointer events) so a click falls through to the viewport and creates a
   * text object on top at that point. Story 10: the same holds for every
   * non-Select tool (the Shape/Connector tools own the gesture through
   * their tool layer; inert is the belt-and-braces guard).
   */
  inert?: boolean;
  /** The live camera (story 10: the connector sizes its handles and hit
   *  stroke in screen space and converts handle-release points). */
  camera?: Camera;
  /** The full live snapshot (story 10: the connector hit-tests re-attach
   *  releases against the other objects). */
  objects?: readonly ObjectSnapshot[];
}

/** One registered object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Bounding-box resize handles are offered when any selected spec has this. */
  resizable: boolean;
  /** Resize keeps the width/height ratio (sticky notes stay square). */
  aspectLocked: boolean;
  /** Smallest side, in world units. Feeds clampScale in the transform gesture. */
  minSize: number;
  /** Double-click / Enter opens an inline text editor. */
  editableText: boolean;
  /** True when the world point hits the object. `zoom` (screen px per
   *  world unit) lets screen-space tolerances (connector hit) convert to
   *  world units; bbox types ignore it. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom: number): boolean;
  /**
   * Which resize handles this type offers (story 9): 'horizontal' means
   * only the e/w handles (free text: width only — the height is derived
   * from the measured layout). Default 'all'.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Story 9: applied instead of resizeObjects for this object during a
   * GROUP resize (types whose box is not freely scalable, like free text:
   * repositioned proportionally, fixed widths scale, font never changes).
   * `target` is the object's rect scaled within the group box.
   */
  applyGroupResize?(doc: Y.Doc, id: string, target: Rect): void;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error: the same type must not be registered twice).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // The type is now known to the document layer (allObjectIds, objectBounds…).
  addKnownObjectType(type);
}

/** The spec for `type`, or undefined when the type is unknown to this client. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---------------------------------------------------------------------------
// sticky
// ---------------------------------------------------------------------------

function pointWithinBounds(obj: ObjectSnapshot, p: Point, _zoom: number): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: pointWithinBounds,
});

// ---------------------------------------------------------------------------
// text (story 9)
// ---------------------------------------------------------------------------

/**
 * Group resize for a free text object (story 9, sel.transform): the object
 * is repositioned proportionally with the group; a FIXED-width text scales
 * its width (clamped to the minimum by setTextWidthFixed), an auto text
 * keeps its content-driven width; the font size never changes and the
 * height is re-derived by the box sync (never written here).
 */
function applyTextGroupResize(doc: Y.Doc, id: string, target: Rect): void {
  if (getTextWidthMode(doc, id) === 'fixed') {
    setTextWidthFixed(doc, id, target.width);
  }
  moveObjects(doc, new Map([[id, { x: target.x, y: target.y }]]));
}

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: pointWithinBounds,
  applyGroupResize: applyTextGroupResize,
});

// ---------------------------------------------------------------------------
// shape (story 10)
// ---------------------------------------------------------------------------

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: pointWithinBounds,
});

// ---------------------------------------------------------------------------
// connector (story 10)
// ---------------------------------------------------------------------------

/**
 * Precise line hit test (connector.select): a point hits when it is within
 * CONNECTOR_HIT_TOLERANCE_PX screen pixels of the arrow's line — the
 * tolerance is divided by the zoom to convert to world units. Points inside
 * the arrow's bounding box but farther from the line never hit.
 */
function connectorHitTest(obj: ObjectSnapshot, p: Point, zoom: number): boolean {
  const from = obj.fromPoint;
  const to = obj.toPoint;
  if (from === undefined || to === undefined || !(zoom > 0)) {
    return false;
  }
  return distanceToPolyline([from, to], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: connectorHitTest,
});

// ---------------------------------------------------------------------------
// stroke (story 11)
// ---------------------------------------------------------------------------

/**
 * Precise line hit test (pen.select): a point hits when it is within
 * max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom) of the stroke's line —
 * the screen-pixel tolerance is converted to world units so it holds at
 * every zoom. A single point (a dot) is hit-tested as a point. Points
 * inside the stroke's bounding box but farther from the line never hit, so
 * the press falls through to the object underneath.
 */
function strokeHitTest(obj: ObjectSnapshot, p: Point, zoom: number): boolean {
  const stroke = obj as StrokeSnap;
  if (stroke.points === undefined || !(zoom > 0)) {
    return false;
  }
  const points = scaledPoints(stroke);
  if (points.length === 0) {
    return false;
  }
  const tolerance = Math.max(
    PEN_THICKNESS_WORLD[stroke.thickness ?? 'medium'] / 2,
    STROKE_HIT_TOLERANCE_PX / zoom,
  );
  const distance =
    points.length === 1
      ? Math.hypot(p.x - points[0].x, p.y - points[0].y)
      : distanceToPolyline(points, p);
  return distance <= tolerance;
}

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest,
});
