import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { connectorPoints, isConnectorSnapshot } from '../../shared/objects/connector';
import { isStrokeSnapshot, scaledPoints } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StrokeObject } from './StrokeObject';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * Everything the board needs to know about one kind of object.
 *
 * Story 7's selection, moving, resizing and deleting are generic: a type declares
 * only whether it can be resized, whether it keeps its proportions, how small it
 * may go, whether it holds editable text, and how to tell a point inside it from
 * a point outside it. A story that adds a type registers one of these in its own
 * file and writes no interaction code (design key decision 5).
 */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while this page may not change the board (story 4's `canEdit`). */
  editable: boolean;
  /**
   * Selection, group move and the drag threshold: see `useTransformGesture`.
   *
   * An SVG element is allowed as well as an HTML one, because a type whose drawing is a
   * picture rather than a box (story 10's arrow) receives its presses on a `<line>`.
   */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement | SVGElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  /** Whether it holds editable text: `Enter` opens it for typing. */
  editableText: boolean;
  /**
   * Which handles a selection of only this type draws. `all` is the eight of a
   * box; `horizontal` is the left and right edges only, for a type whose height is
   * derived from its content and must not be dragged (story 9's text, PRD
   * text.height). A mixed selection shows the eight.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Whether `worldPoint` counts as being on this object.
   *
   * The third argument is what the hit needs beyond the object: the zoom, because a
   * tolerance stated in screen pixels is a different number of board units at every
   * zoom, and the boxes of the other objects, because a connector's line is not in its
   * own record. Types that are their own box ignore it, so every hit test written
   * before story 10 still works when called with two arguments.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, context?: HitTestContext): boolean;
}

export interface HitTestContext {
  /** Screen pixels per board unit. Defaults to 1, which is 100%. */
  zoom?: number;
  /** The box of every object by id, for a type whose geometry is derived. */
  rects?: ReadonlyMap<string, Rect>;
}

const types = new Map<string, ObjectTypeSpec>();

/**
 * Declare an object type. Registering the same type twice is a programming error
 * — two specs for one type would make the second one's behaviour unreachable, so
 * it throws rather than silently disagreeing with itself.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`object type "${type}" is already registered`);
  types.set(type, spec);
}

/** The spec for `type`, or undefined when this client cannot draw it at all. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

/** True for every type this client can draw and therefore select. */
export function isSelectableObjectType(type: string): boolean {
  return types.has(type);
}

/**
 * Whether a board point is on this object, by the rules of its type — false for a
 * type this client cannot draw, which is the same answer as "not there".
 *
 * This is the one door to the per-type rule, so the tool that asks "what is under the
 * pointer" (story 10's Connector tool, a selected arrow's end handle) asks it here
 * rather than repeating each type's geometry.
 */
export function hitTestObject(
  obj: ObjectSnapshot,
  worldPoint: Point,
  context: HitTestContext = {},
): boolean {
  return getObjectType(obj.type)?.hitTest(obj, worldPoint, context) ?? false;
}

/** A rectangle's own hit test: the box, edges included. */
function boxHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const box = objectBounds(obj);
  return (
    worldPoint.x >= box.x &&
    worldPoint.x <= box.x + box.width &&
    worldPoint.y >= box.y &&
    worldPoint.y <= box.y + box.height
  );
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  // A sticky note is square (PRD 7.3), so its resize keeps the proportions.
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boxHitTest,
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  // Text keeps its proportions only in the sense that it has none to keep: its
  // height is always its content's height.
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boxHitTest,
});

// Story 10: the three drawn shapes are one type. They share a component, a toolbar and
// these rules, and differ only in the outline drawn inside the box — so a box hit test
// is right for all three, and story 7's move, resize and delete apply untouched.
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  // A rectangle, an ellipse and a diamond all take the shape of the box they are
  // given, so no drag has to keep the proportions.
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boxHitTest,
});

// An arrow is not its box: a diagonal across the board has a box the size of the board,
// and clicking in the middle of it selects nothing. What counts is being within six
// screen pixels of the line — which, at this zoom, in these board units, is however far
// six screen pixels is.
registerObjectType('connector', {
  Component: ConnectorObject,
  // Its geometry belongs to its ends, so there is nothing for a box handle to mean;
  // the two ends are dragged instead, and the component draws them.
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj, worldPoint, context = {}) {
    if (!isConnectorSnapshot(obj)) return false;
    const zoom = context.zoom && context.zoom > 0 ? context.zoom : 1;
    const points = connectorPoints(obj, context.rects ?? EMPTY_RECTS);
    return distanceToPolyline(points, worldPoint) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
  },
});

// Story 11: a freehand sketch is not its box either. A loop drawn round three notes has a
// box the size of those notes, most of it empty, and clicking in the middle of it selects
// nothing — what counts is being within six screen pixels of the line, or half the pen's
// width if the pen was thicker. The same rule is drawn as an invisible stroke by the
// component, so the picture you can hit and the test that selects it agree.
registerObjectType('stroke', {
  Component: StrokeObject,
  // A sketch is a box that story 7 can move and resize like any other: the drawing inside
  // it is scaled by `scaledPoints`, and the pen's weight is not scaled at all (PRD
  // pen.resize).
  resizable: true,
  // Freehand art has proportions, and they are the ones it was drawn with: a drag of a
  // corner scales the sketch, it does not stretch it.
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj, worldPoint, context = {}) {
    if (!isStrokeSnapshot(obj)) return false;
    const zoom = context.zoom && context.zoom > 0 ? context.zoom : 1;
    const points = scaledPoints(obj);
    if (points.length === 0) return false;
    // The points are measured from the box's own origin, so the question is asked there.
    const box = objectBounds(obj);
    const local = { x: worldPoint.x - box.x, y: worldPoint.y - box.y };
    return (
      distanceToPolyline(points, local) <=
      Math.max(PEN_THICKNESS_WORLD[obj.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom)
    );
  },
});

const EMPTY_RECTS: ReadonlyMap<string, Rect> = new Map();

/**
 * The handles a selection of exactly these types should draw: the two edges when
 * every type in it derives its height, the eight of a box otherwise (story 9,
 * design key decision 2). An unknown type is treated as an ordinary box, which is
 * what a newer client's object looks like from here.
 */
export function handlesFor(objectTypes: readonly string[]): 'all' | 'horizontal' {
  if (objectTypes.length === 0) return 'all';
  return objectTypes.every((type) => types.get(type)?.handles === 'horizontal')
    ? 'horizontal'
    : 'all';
}
