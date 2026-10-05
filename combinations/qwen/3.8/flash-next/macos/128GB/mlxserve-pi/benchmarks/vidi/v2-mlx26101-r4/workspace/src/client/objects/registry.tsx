/**
 * The registry of object types: what each type looks like, and what the board is
 * allowed to do to it.
 *
 * Everything the selection does — the handles it offers, whether a drag keeps the
 * proportions, how small a thing may go, whether Enter opens it for typing — is asked
 * of the type here rather than guessed from what happens to be selected. That is what
 * makes the story's promise ("the same behaviour for every object type") a property of
 * this file rather than of the sticky note: stories 9-12 add a `registerObjectType`
 * call and get selection, group moves, marquee, keyboard, deletion and the resize
 * limits for nothing, because nothing below this file knows what a sticky note is.
 *
 * The registry is deliberately not a `Map` of constructors to build: a type is
 * registered by name, once, and a second registration of the same name is a bug in the
 * code that is thrown at rather than silently overwriting how the board draws objects
 * people are looking at.
 */
import type { ComponentType } from 'react';
import type * as Y from 'yjs';

import { registerKnownObjectType } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { Handle, Rect } from '../../shared/geometry';
import { rectContains, type Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { endPosition, resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { isConnectorSnapshot } from '../../shared/objects/connector';
import { isStrokeSnapshot, strokeHit } from '../../shared/objects/stroke';
import type { ObjectSnapshot } from '../../shared/board-model';
import { StickyNote } from './StickyNote';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';
import { resizeTextBox } from './textLayout';
import type { ObjectProps } from './objectProps';

export type { ObjectInteraction, ObjectProps } from './objectProps';

/**
 * Which handles a type offers.
 *
 * `all` is the eight a box has. `horizontal` is the two on either side, and it exists because a piece of
 * text has no height to drag: its height is counted in lines, so a handle that pulled it taller would be an
 * offer to do something that cannot be done — the words would fill the same lines the moment the pointer
 * let go. A type that cannot be resized at all offers none, which is what `resizable: false` already says.
 */
export type ResizeHandles = 'all' | 'horizontal';

/** The eight, in the order the overlay draws them. */
const ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

/** The two that move a piece of text's words into fewer or more lines. */
const HORIZONTAL_HANDLES = ['e', 'w'] as const;

/** Every handle name a selection can offer, in the overlay's own order. */
export const RESIZE_HANDLES: Record<ResizeHandles, readonly Handle[]> = {
  all: ALL_HANDLES as readonly Handle[],
  horizontal: HORIZONTAL_HANDLES as readonly Handle[],
};

/** What a type is told about the pointer's surroundings when it is asked whether it was hit. */
export interface HitTestContext {
  /**
   * How big the board is drawn, in screen pixels per board unit.
   *
   * Most types have no use for it: a note is hit when the point is inside it, and it makes no difference to
   * that how far away the board is zoomed. An arrow has, because the only thing about an arrow is a line —
   * and a line 2 units thick is a fifth of a pixel at ten per cent zoom, which no pointer can find. The
   * tolerance that makes up the difference is counted in *pixels* and turned into board units by this
   * number, which is the same reason the resize handles are a fixed size on the screen.
   */
  scale?: number;
  /**
   * The boxes of everything on the board, for a type whose own position is a consequence of somebody
   * else's. An arrow's ends are attached to objects, and where it is drawn is where they are.
   */
  rects?: ReadonlyMap<string, Rect>;
}

/** What the board can do to one type of object, and how it is drawn. */
export interface ObjectTypeSpec {
  /** The component that paints one object of this type, and handles its own text. */
  Component: ComponentType<ObjectProps>;
  /** False for a type that has one size: no handles are drawn for it at all. */
  resizable: boolean;
  /** True for a type whose width and height must keep their ratio (a note stays square). */
  aspectLocked: boolean;
  /** The smallest side this type accepts, in world units. */
  minSize: number;
  /** Whether Enter and a double-click open this type for typing. */
  editableText: boolean;
  /** Which handles this type answers to; every handle, unless it says otherwise. */
  handles?: ResizeHandles;
  /** Whether a world point lands on this object. A rotated shape overrides this later. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, context?: HitTestContext): boolean;
  /**
   * What a resize does to this type, when its box is not simply the box it is drawn at.
   *
   * The gesture hands over the rect the pointer has dragged to, and the type decides what its own box is.
   * A sticky note has none of this — its box is whatever it was told — but a piece of text takes the width,
   * lays its words inside it and counts the lines, so the height that comes out is not the height that went
   * in. Called once per frame per object, in the gesture's own write, so a type that measures has to be
   * quick about it.
   */
  resize?(doc: Y.Doc, id: string, rect: Rect): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Add an object type. Registering the same name twice is a programming mistake —
 * two components claiming to draw the same objects — so it throws rather than
 * letting the last module to be imported decide what the board looks like.
 *
 * Registering a type also tells the document model about it, so `snapshot` reports
 * objects of that type and the board can select, move and delete them; a type nobody
 * registered stays in the document unseen, which is how this build opens a board that
 * a later story wrote without being able to edit objects out of what it cannot draw.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type === '') throw new Error('An object type needs a name');
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** The type as the board knows it, or `undefined` for a type this build cannot draw. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered type name, for a settings screen or a test that wants them all. */
export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}

/**
 * Whether an object was clicked, asked of its type. An object of a type the board does
 * not know cannot be drawn, so it cannot be hit either.
 *
 * The context is passed straight through, and is left out by callers that have nothing to add: a marquee
 * drawn across the board knows the board's units as well as the note inside it does.
 */
export function hitTestObject(obj: ObjectSnapshot, worldPoint: Point, context?: HitTestContext): boolean {
  const spec = registry.get(obj.type);
  return spec ? spec.hitTest(obj, worldPoint, context) : false;
}

/**
 * What a whole selection permits, from the types inside it.
 *
 * The rules are the ones a person would guess without being told: a group that contains
 * something that cannot be resized cannot be resized (no handles at all, rather than
 * handles that do nothing to half the objects); a group that contains something that
 * must keep its proportions has them locked for the whole box, because one scale is
 * applied to the whole selection; and the handles belong to the smallest thing in the
 * group as much as to the largest, so nothing can be dragged below its own minimum.
 */
export function describeSelection(objects: readonly ObjectSnapshot[]): {
  resizable: boolean;
  aspectLocked: boolean;
  editableText: boolean;
  minSizes: number[];
  handles: readonly Handle[];
} {
  const minSizes: number[] = [];
  let resizable = objects.length > 0;
  let aspectLocked = false;
  let editableText = false;
  // The handles a group offers are the ones every object in it answers to: a selection of a note and a
  // piece of text is resized by the sides, because pulling the text taller is not a thing that can happen,
  // and the note is quite content to be resized from its sides too. The least capable object is the one
  // that decides, which is the same rule that decides the smallest minimum size and whether the box is
  // aspect-locked at all.
  let horizontalOnly = true;

  for (const object of objects) {
    const spec = registry.get(object.type);
    if (!spec) {
      // Should not happen — the snapshot does not contain types nobody registered —
      // but an object the board cannot describe is not a reason to offer handles that
      // would resize it by guesswork.
      resizable = false;
      minSizes.push(STICKY_SIZE_WORLD);
      continue;
    }
    resizable = resizable && spec.resizable;
    aspectLocked = aspectLocked || spec.aspectLocked;
    editableText = editableText || spec.editableText;
    // Only a group made entirely of things that cannot be pulled taller is drawn without the top and bottom
    // handles. A group that contains a note is resized as a box, and the objects inside it each do what they
    // can with the rect the pointer gives them — the note changes shape, the text takes the width and counts
    // its own lines. Taking the corners away from somebody resizing a note because a heading happens to be
    // in the way would be the text's limitation turned into the note's handicap.
    horizontalOnly = horizontalOnly && (spec.handles ?? 'all') === 'horizontal';
    minSizes.push(spec.minSize);
  }

  return {
    resizable,
    aspectLocked,
    editableText,
    minSizes,
    handles: RESIZE_HANDLES[resizable && horizontalOnly ? 'horizontal' : 'all'],
  };
}

/** The rectangle an object takes up, which is what a point is tested against. */
function rectHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(
    { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
    { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 },
  );
}

/* ------------------------------------------------------------------ sticky -- */

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  // A note is square and stays square: an oblong sticky note is a different object.
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

/* ------------------------------------------------------------------ text -- */

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  // Text is not a shape, so it has no proportions to keep. What it does have is a height that belongs to
  // its words: dragging it taller would be dragging something that is decided elsewhere.
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  // Two handles rather than eight, for the same reason: see `ResizeHandles`.
  handles: 'horizontal',
  hitTest: rectHitTest,
  // The width is the person's, the height is the words'. One write, so one undo puts the drag back whole.
  resize: resizeTextBox,
});

/* ----------------------------------------------------------------- shape -- */

registerObjectType('shape', {
  Component: ShapeObject,
  // A shape is a box somebody dragged, and it keeps the proportions of nothing: an ellipse drawn 300 wide
  // and 100 tall is a wide ellipse, which is a thing people draw on purpose.
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  // A shape has a label, and the way to write one is the way to write in anything else on the board.
  editableText: true,
  hitTest: rectHitTest,
});

/* ------------------------------------------------------------- connector -- */

registerObjectType('connector', {
  Component: ConnectorObject,
  // An arrow has no box to pull. Its ends are pulled instead, and that belongs to the arrow itself — which
  // is why the selection overlay draws no handles for it and the arrow draws two of its own.
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest: connectorHitTest,
});

/**
 * Whether a point is on an arrow — which is a question about distance, not about a box.
 *
 * An arrow's box is the smallest rectangle around its two ends, and for an arrow drawn between two objects
 * on the same row that box has no height at all. Asking whether a point is inside it would ask whether the
 * point is on the line's own centreline, which is a question no pointer can answer: it would come back
 * "nothing was clicked" for every click a person made squarely on an arrow they could see.
 *
 * So the arrow is hit when the point is within a pointer's tolerance of the line: `CONNECTOR_HIT_TOLERANCE_PX`
 * screen pixels, divided by the zoom to put it into board units — which is what makes an arrow as easy to
 * click at ten per cent as at four hundred, and what makes a click seven pixels away from the line *not* an
 * arrow at any zoom, which is the difference between a tool that selects arrows and a tool that selects
 * whatever was near where the arrow might have been. Without a zoom to divide by there is nothing to convert
 * with, and the tolerance is taken as board units: the same number, read conservatively.
 */
function connectorHitTest(obj: ObjectSnapshot, worldPoint: Point, context?: HitTestContext): boolean {
  const ends = endsOf(obj, context?.rects);
  if (ends === null) return false;
  const scale = context?.scale;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (scale !== undefined && scale > 0 ? scale : 1);
  return distanceToPolyline([ends.from, ends.to], worldPoint) <= tolerance;
}

/**
 * The two points an arrow is drawn between.
 *
 * The board's own snapshot carries them, already resolved against the boxes of the objects they are attached
 * to, and that is the answer used whenever there is one: the same two points the arrow is painted between, so
 * a click and a picture cannot disagree about where the arrow is. Only an object that does not carry them —
 * a reader from an older build, handed the boxes by the caller — has to derive them here, and an object that
 * carries neither ends nor boxes has no line to be on and is not hit, which is the same answer the board gives
 * by drawing nothing.
 */
function endsOf(obj: ObjectSnapshot, rects?: ReadonlyMap<string, Rect>): { from: Point; to: Point } | null {
  if (!isConnectorSnapshot(obj)) return null;
  // The boxes are there: ask the same function the painter asks, and get the same two points down to the
  // last rounding.
  if (rects !== undefined) return resolveEndpoints(obj, rects);
  // The boxes are not there — a caller that has the snapshot and nothing else. An attached end knows the
  // point it was last drawn at, which is the best that can be said without looking at where its object has
  // got to: a click a few units from an arrow whose object has moved is then judged against where the arrow
  // used to be. That is a worse answer than the one above, and a better one than "there is no arrow".
  return { from: endPosition(obj.from), to: endPosition(obj.to) };
}

/* ------------------------------------------------------------------- stroke -- */

/**
 * Whether a point is on a drawing — the same question an arrow's raises, and the same answer.
 *
 * A drawing's box is the rectangle around its line with half a nib of paint added around it, and for a
 * signature drawn flat that box is a wide strip of nothing. Asking whether a point is inside it would be asking
 * whether the point is anywhere near the drawing, which every click near it would answer yes to and half the
 * board would therefore be unreachable: a drawing is drawn *over* things, so a box hit test would put an
 * invisible wall over every note it crossed. So the point is measured against the line, by `strokeHit`, which
 * is the same distance story 10 gave an arrow — `max(half the nib, six screen pixels)`, the six divided by the
 * zoom because they are a fact about a pointer on a screen and the board is measured in board units. Half the
 * nib is the floor rather than the line's own width, because a stroke paints half its width on either side of
 * its points and a click that lands on the paint would otherwise select nothing.
 *
 * An object that is not a readable drawing is not hit, which is what an unreadable record means everywhere else
 * in the board: it is left in the document for a build that can read it, and it is not clickable in this one.
 */
function strokeHitTest(obj: ObjectSnapshot, worldPoint: Point, context?: HitTestContext): boolean {
  if (!isStrokeSnapshot(obj)) return false;
  return strokeHit(obj, worldPoint, context?.scale ?? 1);
}

registerObjectType('stroke', {
  Component: StrokeObject,
  // A drawing is a box somebody drew in, and story 7's handles can pull it: what changes is the box, and
  // `scaledPoints` scales the drawing inside it. Nothing has to be rewritten point by point, which is the only
  // reason a resize of a five thousand point signature is one write rather than five thousand.
  resizable: true,
  // Proportional, the way a note is. A drawing is a picture *of* something — a face, a map, a diagram — and
  // pulling the width without the height turns it into a picture of a longer, thinner thing, which is not what
  // anybody means when they drag a corner. (`scaledPoints` scales each axis by its own box, so a drag of a side
  // handle would still stretch; what this decides is the handles offered, and the corners are the ones that
  // mean "bigger", which is what `pen.resize` is about.)
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  // A drawing has no words in it. Double-clicking one to type into it would be a shape's label wearing a
  // polyline's clothes, and there is nothing here to type into.
  editableText: false,
  hitTest: strokeHitTest,
});
