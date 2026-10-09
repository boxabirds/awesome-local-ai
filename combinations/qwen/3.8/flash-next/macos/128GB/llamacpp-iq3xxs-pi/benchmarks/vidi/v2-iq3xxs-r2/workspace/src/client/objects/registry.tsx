import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import {
  markObjectTypeKnown,
  objectBounds,
  STICKY_TYPE,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed, TEXT_TYPE } from '../../shared/objects/text';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { SHAPE_TYPE } from '../../shared/objects/shape';
import { isConnectorSnapshot, CONNECTOR_TYPE } from '../../shared/objects/connector';
import { isStrokeSnapshot, scaledPoints, STROKE_TYPE } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import type { EndEditNext } from '../board/useSelection';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StrokeObject } from './StrokeObject';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * The object type registry (`sel.registry`): the one place that knows what a board object
 * type can do. A type declares *only* whether it can be resized, whether it keeps its
 * proportions, how small it may go, whether its text can be edited, and how a point hits
 * it. Selecting, moving, resizing and deleting stay generic, so stories 9–12 add a type
 * without adding a line of interaction code (sel.all_types).
 */

/**
 * What every object type is handed: the object's own data, plus this client's local
 * selection/editing state and the one gesture entry point. Nothing else, so a new type
 * cannot reach into selection machinery even by accident.
 */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom, for anything that must stay the same size on screen (toolbars). */
  zoom: number;
  /** Is this object part of what this client has selected? */
  selected: boolean;
  /** How many objects this client has selected; a toolbar appears for exactly one. */
  selectedCount: number;
  /** This object's text is being edited. */
  editing: boolean;
  /** A board that could not be loaded refuses edits but still allows selecting. */
  readOnly: boolean;
  /** A transform gesture (move or resize) is running on this client's board. */
  dragging: boolean;
  /**
   * Every other object's box, by id (story 10). Only an arrow asks: dragging one's end onto
   * another object means knowing which object a board point is over, and the boxes the board
   * has already read are the cheapest way to answer that. Arrows are left out of it — an
   * arrow's box is its two ends, which makes it a box mostly full of empty board.
   */
  readonly rects?: ReadonlyMap<string, Rect>;
  /** Pressing an object is the start of a possible move: the gesture owns it from here. */
  /**
   * The event may come from an HTML element or from an SVG one — an arrow's press is handled
   * on its `<svg>`, and the gesture does not care which kind of element it landed on.
   */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement | SVGElement>, id: string): void;
  /** Selecting without a pointer: keyboard focus reaching an object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** What a type declares about itself. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** False for a type that is placed but never resized: no handles are shown for it. */
  resizable: boolean;
  /** True when resizing must keep the box's ratio (a sticky note, an image). */
  aspectLocked: boolean;
  /** The smallest side this type allows, in board units. */
  minSize: number;
  /** True when the object carries text the user can type into (story 2 stickies). */
  editableText: boolean;
  /**
   * Which handles a selection of only this type gets. `'horizontal'` for a type whose height
   * is its content and cannot be dragged (a text object): the box is drawn, and only its two
   * side handles are. Absent means every handle.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Resize one object of this type to `to`, for a type where resizing is not simply making
   * its box that size: a text object stores a *width mode* next to its width, so its side
   * handle pins the width instead of scaling a box. Absent means the generic box resize.
   */
  resizeObject?(doc: Y.Doc, id: string, to: Rect): void;
  /**
   * Is `worldPoint` on this object? Rectangular types: inside their bounds. `zoom` is asked
   * for by types whose hit area is not their box — an arrow is clicked by how close to its
   * line the pointer was, and that tolerance is `CONNECTOR_HIT_TOLERANCE_PX` *screen* pixels,
   * which is a smaller number of board units the closer the board is (TC-20).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

/** Every type this build knows. Populated at import; nothing clears it. */
const TYPES = new Map<string, ObjectTypeSpec>();

/**
 * Declare an object type. Called once per type at module load — stories 9–12 add a type by
 * registering it here and by importing their module, and get selecting, moving, resizing,
 * deleting, handles, marquee, keyboard and undo-boundary behaviour without writing any of
 * it themselves (sel.all_types).
 *
 * Registering the same name twice is a programming error that would silently replace the
 * spec of a type that is probably on screen already, so it throws at import instead.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error('registerObjectType: an object type needs a name');
  }
  if (TYPES.has(type)) {
    throw new Error(`registerObjectType: object type "${type}" is already registered`);
  }
  TYPES.set(type, spec);
  // The model reads every object, but only selects the types it was told about (TC-08).
  markObjectTypeKnown(type);
}

/** The spec for `type`, or undefined when this build does not know it (TC-12). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  if (typeof type !== 'string') return undefined;
  return TYPES.get(type);
}

/**
 * The component that draws `object`, or undefined — in which case the board draws nothing
 * for it. Unknown types are skipped rather than thrown about, so a document written by a
 * later build cannot break this one.
 */
export function getObjectComponent(object: ObjectSnapshot): ComponentType<ObjectProps> | undefined {
  return getObjectType(object.type)?.Component;
}

/** The specs of a whole selection, skipping types nobody registered (unknown objects). */
export function specsFor(objects: readonly ObjectSnapshot[]): ObjectTypeSpec[] {
  const specs: ObjectTypeSpec[] = [];
  for (const object of objects) {
    const spec = getObjectType(object.type);
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * The hit test every rectangular type so far needs (TC-11): a point on the object's box,
 * edges included. An image with a transparent background (story 12) declares its own.
 */
export function boundsContain(object: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(objectBounds(object), {
    x: worldPoint.x,
    y: worldPoint.y,
    width: 0,
    height: 0,
  });
}

registerObjectType(STICKY_TYPE, {
  Component: StickyNote,
  // A sticky note may be resized, keeps its square, and never gets smaller than 50 units.
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsContain,
});

/**
 * What a text object's side handle does: pin the width the drag reached, which brings the
 * fixed width mode with it. Height is not asked for — it is what the text now needs, and the
 * client that made the drag measures it (`useTextBoxSync`).
 */
function resizeTextWidth(doc: Y.Doc, id: string, to: Rect): void {
  setTextWidthFixed(doc, id, to.width);
}

registerObjectType(SHAPE_TYPE, {
  Component: ShapeObject,
  // A shape is resized freely: a rectangle that would not go thin would not be a rectangle.
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsContain,
});

/**
 * An arrow is not a box: the point has to be near its line. The tolerance is stated in screen
 * pixels (PRD: "within 6 screen pixels"), so it is divided by the zoom to get the board units
 * this point is measured in — which is what makes a click that is close enough at 100% still
 * close enough at 200% (TC-20).
 */
function nearConnector(obj: ObjectSnapshot, worldPoint: Point, zoom = 1): boolean {
  if (!isConnectorSnapshot(obj)) return false;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
  return distanceToPolyline([obj.ends.from, obj.ends.to], worldPoint) <= tolerance;
}

registerObjectType(CONNECTOR_TYPE, {
  Component: ConnectorObject,
  // An arrow goes where its ends go: there is no box of it to drag handles about.
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: nearConnector,
});

/**
 * A freehand line is clicked by how close the pointer came to it, not by whether it landed
 * inside its box — the box of a scribble is mostly empty board, and a click in it means the
 * thing underneath (PRD: pen.select). The tolerance is `STROKE_HIT_TOLERANCE_PX` *screen*
 * pixels, or half the line's own thickness if that is thicker, divided by the zoom to get the
 * board units this point is measured in — the same rule an arrow is clicked by.
 */
function nearStroke(obj: ObjectSnapshot, worldPoint: Point, zoom = 1): boolean {
  if (!isStrokeSnapshot(obj)) return false;
  const half = (PEN_THICKNESS_WORLD[obj.thickness] ?? 0) / 2;
  const tolerance = Math.max(half, STROKE_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1));
  return distanceToPolyline(scaledPoints(obj), worldPoint) <= tolerance;
}

registerObjectType(STROKE_TYPE, {
  Component: StrokeObject,
  // A stroke has a box, so it gets handles; the box keeps its ratio, because stretching a
  // sketch sideways would draw it again rather than enlarge it (PRD: pen.resize).
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: nearStroke,
});

registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  // Wider, never taller: the height is the text, and the narrowest it may be pinned to is
  // the narrowest box one of these can have.
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  resizeObject: resizeTextWidth,
  hitTest: boundsContain,
});
