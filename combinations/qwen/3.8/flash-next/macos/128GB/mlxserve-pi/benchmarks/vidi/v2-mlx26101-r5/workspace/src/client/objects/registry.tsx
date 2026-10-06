/**
 * The object-type registry (design capability `obj.registry`).
 *
 * A board object is anything a story has decided to put on the board. Today there is one type, the
 * sticky note; stories 9 to 12 add text, shapes, drawings and images by calling
 * {@link registerObjectType} and touching nothing else. Selection, marquee, group drag, resize,
 * delete, nudge and copy/paste all walk this list, which is why *select all* can promise that it
 * selects every object on the board whatever it is — and why a board written by a newer client still
 * opens here: an object whose type this build does not know is listed in the snapshot, is not
 * rendered, and is left strictly alone.
 *
 * A type declares five things: what draws it, whether it can be resized, whether it keeps its
 * proportions, how small it may go, and where it is. Those are the only per-type knobs there are —
 * a type cannot have its own selection, its own drag or its own delete, which is what keeps a board
 * of six object types behaving as one board.
 */

import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import type { Doc } from 'yjs';

import {
  declareObjectType,
  objectBounds,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { rectContainsPoint, type Point, type Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import type { TextSnapshot } from '../../shared/objects/text';
import type { ConnectorSnapshot } from '../../shared/objects/connector';
import type { ShapeSnapshot } from '../../shared/objects/shape';
import type { StrokeSnapshot } from '../../shared/objects/stroke';
import type { ImageSnap } from '../../shared/objects/image';
import { scaledPoints, strokeHitRadius } from '../../shared/objects/stroke';
import type { Camera } from '../canvas/camera';
import type { UndoControls } from '../board/useUndo';
import { STICKY_OBJECT_TYPE, StickyNote } from './StickyNote';
import { TEXT_OBJECT_TYPE, TextObject } from './TextObject';
import { SHAPE_OBJECT_TYPE, ShapeObject } from './ShapeObject';
import { CONNECTOR_OBJECT_TYPE, ConnectorObject } from './ConnectorObject';
import { IMAGE_OBJECT_TYPE, imageObjectType } from './ImageObject';
import { STROKE_OBJECT_TYPE, StrokeObject } from './StrokeObject';

/**
 * What the board gives an object so that it can take part in the board's behaviour. An object never
 * moves, resizes or deletes itself: it says what it wants and the board does it, so that one gesture
 * can act on a whole selection of mixed types.
 *
 * `T` is the snapshot of the object's own type: a sticky note is drawn with
 * `ObjectProps<StickySnapshot>`. The board reads an object, looks its type up here and hands the
 * component the props of exactly that type.
 */
/**
 * Either kind of pointer event an object can be handed: React's, over the element the press landed on,
 * or the browser's own.
 *
 * The element is a union and not one type because an object is not always a `div`: a note and a shape are
 * pressed on HTML elements, and the only part of an arrow or a drawing that a pointer can hold is an SVG
 * path. A gesture that moves objects by the rules of the document cannot care which sort of element it was
 * pressed on, so both readings are accepted, and the objects do not have to reach for the native event to
 * hand their press to the board.
 */
export type ObjectPointerEvent = ReactPointerEvent<HTMLElement | SVGGraphicsElement> | PointerEvent;

export interface ObjectProps<T extends ObjectSnapshot = ObjectSnapshot> {
  /** The object being drawn. */
  obj: T;
  /** The shared document, for the object's own content (a sticky note's text). */
  doc: Doc;
  /** Current zoom, for the parts of an object that stay the same size on screen. */
  zoom: number;
  /** The object is in the selection. */
  selected: boolean;
  /** This object is the whole selection, so it shows the tools that belong to one object alone. */
  soleSelected: boolean;
  /** A pointer is down on this object and the gesture has not moved yet. */
  pressed: boolean;
  /** A gesture is moving this object. */
  dragging: boolean;
  /** The object's own editing surface is open; the board does not move an object while it is. */
  editing: boolean;
  /** Editing is allowed (false when the board could not be loaded). */
  editable: boolean;
  /** Plain click: this object is the selection, on its own. */
  onSelect(id: string): void;
  /** Open this object's editing surface, if its type has one. Sticky notes do; shapes do not. */
  onStartEdit(id: string): void;
  /**
   * Close this object's editing surface, given this object's id.
   *
   * The id is not decoration: a single pointer press can close one object's editor and open another's,
   * and the object that is finished is the one that says so — closing "the open editor" would close the
   * editor that this very press opened.
   */
  onEndEdit(owner?: string): void;
  /** The object is gone from the document: stop drawing it and drop any editing state. */
  onDeleted(id: string): void;
  /**
   * A pointer went down on the object. The board decides what happens next — a click, a group move,
   * a shift-click that toggles the object in or out of the selection — because a gesture that starts
   * on one object may have to move twenty, and an object that dragged itself would move one object
   * while leaving the selection where it was.
   */
  onObjectPointerDown(event: ObjectPointerEvent, id: string): void;
  /**
   * This person's undo history, for the writes an object makes to its own content.
   *
   * An object that changes its own colour, or asks to be deleted, is doing one thing — and one thing
   * is one step of the history. It says so with `boundary` on either side of the write, because the
   * history cannot tell on its own that a colour click is not the second half of the drag that ended
   * a moment ago: from where it stands they are two writes half a second apart, which is exactly what
   * a burst of typing looks like.
   *
   * Left out, the object's writes are still undone — they simply join whatever step was open.
   */
  undo?: UndoControls;
  /**
   * The board this object is on: its camera, its other objects, their boxes, and how a point on the screen
   * becomes a point on the board.
   *
   * Almost nothing needs it — a note, a shape and a piece of text are each entirely described by their own
   * entry — and it is here for the one type that is not: an arrow, which is drawn between two *other*
   * objects and has to know where they are, and whose handles have to know where the screen is. It is the
   * same picture the board is drawing this frame, handed down rather than looked up, so that an object and
   * the selection around it cannot disagree about where a shape is.
   */
  board?: BoardContext;
}

/**
 * Which handles a type offers: all eight around its box, or the two on its sides.
 *
 * One word per type, decided by the type and read by whoever draws or drags the handles: the overlay
 * that draws them, the gesture that is driven by them and the tests that count them all ask the same
 * question, and none of them is the place the answer belongs.
 */
export type HandlesMode = 'all' | 'horizontal';

/**
 * What a type is told about the pointer when it is asked where it is.
 *
 * Two of the three things an object's own hit test could want are already in its snapshot, and the third —
 * how far a pointer has to be to count as being on it — is not a property of the object at all but of the
 * pointer and the scale the board is drawn at. A sticky note is where its box is at any zoom, so it never
 * looks at this; an arrow is a line six *screen pixels* wide, so it cannot say where it is without knowing
 * the zoom, and cannot say where its ends are without knowing where the objects it is attached to are.
 *
 * Left out, a type is asked the question in the terms it has always been asked: is this point inside the box
 * in the document. That is what the marquee and *select all* ask, and the answer an arrow gives them is its
 * bounding box, which is the honest answer to that question and not the one a click wants.
 */
export interface HitContext {
  /** How big a world unit is on this screen. */
  zoom: number;
  /** Every object's box, by id: the boxes an arrow's ends are placed from. */
  rects: ReadonlyMap<string, Rect>;
}

/**
 * What the board knows, that an object sometimes has to know about the board.
 *
 * An object does not move, resize or select itself, and it does not have to know what else is on the board
 * either — until it is an arrow, whose whole being is a relation between two other objects. This is the
 * small set of board-wide facts an object is given rather than allowed to reach for: where the board is on
 * the screen, what is on it, and what box everything has. Every one of them is the board's own answer to a
 * question the board has already been asked this frame, so there is still exactly one of each.
 */
export interface BoardContext {
  /** The camera this board is being looked through. */
  camera: Camera;
  /** Every object on the board, in stacking order. */
  objects: readonly ObjectSnapshot[];
  /** Every object's box, by id. */
  rects: ReadonlyMap<string, Rect>;
  /**
   * A point on this screen as the point on the board it is over.
   *
   * Given rather than derived, because the board owns the element the pointer is measured against: an
   * object that measured it again would be a second answer to where the board starts, and the two would
   * disagree the moment the board was not the whole window.
   */
  toWorld(point: Point): Point;
}

/**
 * What one object type tells the board about itself.
 *
 * `Component` and `hitTest` are declared as methods rather than as properties holding functions: the
 * board keeps the specifications of every type in one list and hands each component the object of
 * the type it looked up, which is a question a list cannot ask at compile time. Methods are the
 * documented way in TypeScript to say "the type of the object is the type of the props", and it is
 * true here — the object read from the snapshot of type `T` is the object drawn.
 */
export interface ObjectTypeSpec<T extends ObjectSnapshot = ObjectSnapshot> {
  /** How it is drawn, and how it is picked up by a pointer. */
  Component(props: ObjectProps<T>): ReactElement | null;
  /** Whether a resize handle may change its size at all. */
  resizable: boolean;
  /** True when a resize always keeps the object's proportions (a sticky note, a drawing). */
  aspectLocked: boolean;
  /** Smallest this type may be dragged to, in world units. */
  minSize: number;
  /** True when the type has a text body a person can type into (text, sticky notes). */
  editableText: boolean;
  /**
   * Which handles this type has: all eight around the box, or the two on its sides.
   *
   * Left out it is `'all'`, which is every object this board had until story 9. `'horizontal'` is for a
   * thing whose height is its content's own business: a text object has no handle that makes it taller,
   * because the only thing that makes text taller is more text. A type that could not be given a height
   * by a handle does not get one to try.
   */
  handles?: HandlesMode;
  /** Is this object at this world point? Where the type is, is the type's own business. */
  hitTest(obj: T, worldPoint: Point, context?: HitContext): boolean;
}

/**
 * What this build can draw, by type name.
 *
 * A module-level map, like the board itself: there is one board on a page and one registry in a page,
 * and a story's object type registers itself when the module is loaded — which is why adding a type
 * never means editing selection, marquee, group drag, delete or copy/paste.
 */
const registry = new Map<string, ObjectTypeSpec>();

/**
 * Adds an object type.
 *
 * Registering the same type twice is a bug rather than a last-writer-wins race: two definitions of
 * one type means two components that disagree about what a `sticky` is, and whichever won we would be
 * drawing the wrong thing with no clue why. So it throws, at module load, in development.
 */
export function registerObjectType<T extends ObjectSnapshot>(type: string, spec: ObjectTypeSpec<T>): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // The document model keeps its own list of what this build knows about, because select-all and the
  // marquee work from snapshots and must not have to import a React component to ask a question.
  declareObjectType(type);
}

/** The specification of `type`, or undefined when this build does not know that type. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Types this build can draw, in the order they registered. */
export function registeredObjectTypes(): readonly string[] {
  return [...registry.keys()];
}

/**
 * The smallest an object of `type` may be dragged, in world units.
 *
 * A type we cannot draw still takes part in a group resize — it is in the selection, so its box is in
 * the bounding box — and its box still has to stop somewhere. The size we know it to be is the size
 * every object of that type starts out at, which is the one size that cannot be wrong.
 */
export function minSizeWorld(type: string): number {
  return getObjectType(type)?.minSize ?? STICKY_MIN_SIZE_WORLD;
}

/** True when an object of this type always keeps its proportions. Unknown types keep nothing. */
export function keepsAspect(type: string): boolean {
  return getObjectType(type)?.aspectLocked === true;
}

/** Whether a handle may resize this object at all. Unknown types cannot be resized. */
export function isResizableType(type: string): boolean {
  return getObjectType(type)?.resizable === true;
}

/** Whether this object's type has a text body, which is what Enter opens. */
export function hasEditableText(type: string): boolean {
  return getObjectType(type)?.editableText === true;
}

/** Which handles a type offers: `'all'` unless it said otherwise. Unknown types get none at all. */
export function handlesOf(type: string): HandlesMode {
  return isResizableType(type) && getObjectType(type)?.handles === 'horizontal' ? 'horizontal' : 'all';
}

/**
 * The handles a whole selection offers.
 *
 * A selection of text objects has the two side handles, because that is what each of them has. Add a
 * sticky note to it and the selection has eight, because the selection can now resize something that
 * takes any shape it is given — and the text objects in it are resized by that same gesture in the one
 * way they can be: wider, or narrower, with their height following their own content.
 *
 * Types this build cannot draw are not counted: they are in the selection and in the bounding box, but
 * they are not what the handles are offered for.
 */
export function handlesForObjects(objects: readonly ObjectSnapshot[]): HandlesMode {
  let resizable = 0;
  let horizontal = 0;
  for (const obj of objects) {
    if (!isResizableType(obj.type)) continue;
    resizable += 1;
    if (handlesOf(obj.type) === 'horizontal') horizontal += 1;
  }
  return resizable > 0 && resizable === horizontal ? 'horizontal' : 'all';
}

/** Where this object is, according to its own type. Unknown types are nowhere. */
export function hitTestObject(obj: ObjectSnapshot, worldPoint: Point, context?: HitContext): boolean {
  const spec = getObjectType(obj.type);
  return spec ? spec.hitTest(obj, worldPoint, context) : false;
}

/**
 * The object a pointer is on, of the ones on the board — or nothing, which is what most of a board is.
 *
 * The board is walked back to front, which is the order the snapshot is already in and the order the pixels
 * are painted in, so the answer is the object a person would say they were pointing at: the top one. Ties
 * are impossible in a document whose stacking order is a single number, and the first hit wins regardless.
 *
 * This is the question the Connector tool asks on every pointer move, and the question an arrow's handle
 * asks when it is dropped — which is why it asks the registry rather than having an opinion of its own about
 * what is on the board: an arrow is a line, a shape is a box, and the only thing that knows the difference
 * is the type.
 */
export function topmostObjectAt(
  objects: readonly ObjectSnapshot[],
  worldPoint: Point,
  context?: HitContext,
): ObjectSnapshot | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object === undefined) continue;
    if (hitTestObject(object, worldPoint, context)) return object;
  }
  return null;
}

/**
 * Draws one object, whatever its type is — and draws nothing at all when nobody registered one.
 *
 * This is the only place the board asks the registry for a component, which is the whole reason
 * `Board` does not know what a sticky note is: an object whose type is unknown to this build is not
 * rendered, is not deleted, and stays in every selection it was in, waiting for a client that can
 * draw it.
 */
export function ObjectView(props: ObjectProps): ReactNode {
  const spec = getObjectType(props.obj.type);
  if (spec === undefined) return null;
  const Component = spec.Component;
  return <Component {...props} />;
}

// The types this build ships with. Stories 10-12 add their own line here and nothing else.
registerObjectType<StickySnapshot>(STICKY_OBJECT_TYPE, {
  Component: StickyNote,
  // A note is a note: it has a size and a handle can change it.
  resizable: true,
  // …and it is a square of paper, so a corner handle scales it and an edge handle squares it up.
  aspectLocked: true,
  // The size a note stops at when it is dragged smaller than that, and the size a note of this build
  // that never recorded a width is assumed to be.
  minSize: STICKY_MIN_SIZE_WORLD,
  // Its body is the text; Enter opens it.
  editableText: true,
  // A sticky note is exactly where its bounds say it is, to the last unit and not one beyond.
  hitTest: (obj, worldPoint) => rectContainsPoint(objectBounds(obj), worldPoint),
});

registerObjectType<TextSnapshot>(TEXT_OBJECT_TYPE, {
  Component: TextObject,
  // A text object has a width, and a handle can change it.
  resizable: true,
  // …but no proportion of any kind: its height is the number of lines its content makes, so a handle
  // that scaled width and height together would be writing a height that the next keystroke undoes.
  aspectLocked: false,
  // The narrowest a text column may be dragged to, and the width a fixed width never goes below.
  minSize: TEXT_MIN_WIDTH_WORLD,
  // Its body is the text; Enter opens it, and so does a double-click on it.
  editableText: true,
  // Two handles, on the sides: nothing on this board makes a text object taller but more text.
  handles: 'horizontal',
  // The box the document holds is the whole of it: the selection, the marquee and a click all agree
  // with the pixels on the answer the measurement wrote.
  hitTest: (obj, worldPoint) => rectContainsPoint(objectBounds(obj), worldPoint),
});

registerObjectType<ShapeSnapshot>(SHAPE_OBJECT_TYPE, {
  Component: ShapeObject,
  // A shape is a box, and a handle can change the box: that is the whole of what a shape is.
  resizable: true,
  // …without proportion of any kind. A rectangle drawn 300 wide and 100 high is a wide rectangle, and a
  // handle that insisted it stay square would be refusing the shape the person dragged. (Shift squares a
  // shape while it is being *drawn*, which is a different thing from being square for ever.)
  aspectLocked: false,
  // The smallest a shape may be dragged to, and the size below which a drag is read as a click and the
  // shape gets the standard size instead.
  minSize: SHAPE_MIN_SIZE_WORLD,
  // Its label is a text body: Enter opens it, a double-click opens it, and 500 characters is its limit.
  editableText: true,
  // A shape is exactly where its box is. Not "exactly where its ellipse is" — the box an arrow attaches to
  // and a selection draws around is the box in the document, and a hit test that knew the curve better than
  // the box would be an arrow attaching to a corner of a box that is not there.
  hitTest: (obj, worldPoint) => rectContainsPoint(objectBounds(obj), worldPoint),
});

registerObjectType<ConnectorSnapshot>(CONNECTOR_OBJECT_TYPE, {
  Component: ConnectorObject,
  // An arrow has no size to resize. Its four numbers are derived from wherever its ends are, and a handle
  // that wrote them would be writing an answer to a question nobody asked.
  resizable: false,
  aspectLocked: false,
  // It has no minimum size either, so this is the length under which the model refuses to make one at all.
  minSize: 0,
  // There is nothing to type into: an arrow's whole content is which two things it joins.
  editableText: false,
  // With the board's context, an arrow is its line: six screen pixels either side of it, at any zoom. The
  // tolerance is divided by the zoom to get the world distance a click may miss by, which is the whole of
  // why an arrow is exactly as easy to pick up at 50 % as at 200 %.
  // Without it — the marquee, *select all* — an arrow is the box its two ends make, which is what a
  // rectangle drawn around a diagram encloses.
  hitTest: (obj, worldPoint, context) => {
    if (context === undefined) return rectContainsPoint(objectBounds(obj), worldPoint);
    const ends = resolveEndpoints({ from: obj.from, to: obj.to }, context.rects);
    return distanceToPolyline([ends.from, ends.to], worldPoint) <= CONNECTOR_HIT_TOLERANCE_PX / context.zoom;
  },
});

registerObjectType<StrokeSnapshot>(STROKE_OBJECT_TYPE, {
  Component: StrokeObject,
  // A drawing has a box — the box around the line that was drawn — and a handle can change it. What the
  // line does when the box changes is arithmetic (`scaledPoints` scales the points to the box), which is
  // why an object whose shape is two hundred numbers can be resized by the same gesture as a sticky note.
  resizable: true,
  // …and it keeps its proportions while it does. A sketch is a picture of something: a circle dragged
  // wider is a circle squashed, and the person who drags the bottom-right corner of a sketch means "bigger",
  // not "wider". A drawing has no other proportion to keep and no content of its own to resize, so unlike
  // a shape — whose squareness is a property of the *kind* and not of the drawing — it has only this one.
  aspectLocked: true,
  // The size a stroke stops at. A sketch of an arrow dragged to nothing is a sketch of nothing, and four
  // world units is the dot the thickest pen makes, which is the smallest thing this board can draw at all.
  minSize: STROKE_MIN_SIZE_WORLD,
  // There is nothing to type into: a drawing's whole content is the line.
  editableText: false,
  // With the board's context, a drawing is its line: six screen pixels either side of it, or half its own
  // ink where the ink is thicker than that, at any zoom. This is the rule that makes a click inside a
  // circle drawn round three notes a click on the note under it and not a click on the circle, which is
  // the difference between an annotation and a sheet of glass over the board.
  // Without it — the marquee, *select all* — a drawing is the box around it, which is what a rectangle
  // drawn round a sketch encloses, and the box the resize handles are drawn around.
  hitTest: (obj, worldPoint, context) => {
    if (context === undefined) return rectContainsPoint(objectBounds(obj), worldPoint);
    // The zoom is the whole of the tolerance's units, so a zoom that does not have one is asked nothing:
    // a board that cannot say how big a pixel is does not get to select a drawing from across the room.
    const radius = strokeHitRadius(obj, context.zoom);
    return Number.isFinite(radius) && distanceToPolyline(scaledPoints(obj), worldPoint) <= radius;
  },
});

// A picture is the one object on this board whose box is a copy of something else, which is the whole reason
// story 12 had to add anything to this file at all: `aspectLocked` and a minimum of its own are the only two
// rules about dragging that a picture changes (PRD `image.aspect_resize`). The specification itself lives
// with the object, for the same reason the arrow's does — see `ImageObject.tsx`.
registerObjectType<ImageSnap>(IMAGE_OBJECT_TYPE, imageObjectType);
