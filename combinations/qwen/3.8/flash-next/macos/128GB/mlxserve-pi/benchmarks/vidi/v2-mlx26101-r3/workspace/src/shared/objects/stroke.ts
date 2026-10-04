import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  isPenColor,
  isPenThickness,
  type PenColor,
  type PenThickness,
} from '../config';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  STROKE_TYPE,
  canReadObjectType,
  registerObjectReader,
  type ObjectSnapshot,
  type StrokeSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

/**
 * Pen strokes on the board (story 11): the schema, and the two operations that write one.
 *
 * A stroke is a freehand line, stored as the path that was captured and the box it was drawn in. It is
 * an ordinary board object otherwise - moved, stacked, marquee-selected, resized, deleted and undone by
 * the board's own generic operations on `objects` - which is why this module has one creation function
 * and no setters: once a stroke exists, the pen has no more say in it than anybody else does.
 *
 * ```text
 * objects/<id>: Y.Map {
 *   type: 'stroke'
 *   x, y: number             // top-left of the box, world units
 *   width, height: number    // the box the path is drawn in, world units
 *   points: number[]         // flat [x0,y0,x1,y1,…], RELATIVE to x/y, world units
 *   baseWidth, baseHeight    // the box the stroke was drawn at: the resize denominator
 *   color: PenColor          // the drawing colour, in the field every object keeps its colour in
 *   thickness: PenThickness  // 'thin' | 'medium' | 'thick'
 *   z, createdAt, createdBy
 * }
 * ```
 *
 * Two things about that shape are worth stating where the shape is written:
 *
 * **The path is relative to the box**, not to the board. Dragging a stroke therefore rewrites `x` and
 * `y` and touches nothing else, and resizing it rewrites the box and touches nothing else - a stroke
 * that stored board coordinates would have to have every one of its up-to-5000 points rewritten on
 * every frame of a resize, and each of those frames is an update on the wire to every peer.
 *
 * **The box is padded by half the thickness**, so that the box is what is drawn: no part of the line
 * hangs outside the outline drawn around it, and a stroke drawn at one point still has a box (the
 * thickness square) that can be selected, moved and resized.
 *
 * Like the rest of `shared`, this module never throws for user-driven input and knows nothing about
 * pointers, selection or React.
 */

// The type's name is the board model's, because the model's reader has to know it; re-exported so the
// code that writes strokes says `STROKE_TYPE` from where it stands.
export { STROKE_TYPE } from '../board-model';
export type { StrokeSnapshot } from '../board-model';

export {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  isPenColor,
  isPenThickness,
} from '../config';
export type { PenColor, PenThickness } from '../config';

// The model may read strokes as soon as this module is loaded - the one-place registration story 9 and
// story 10 use. A client that never imports this file skips stroke objects instead of failing on them.
registerObjectReader(STROKE_TYPE);

/** What the pen was asked to commit: the path it captured, and what it was set to draw with. */
export interface StrokeDrawing {
  /**
   * The captured path, in world units, in the order it was captured.
   *
   * Simplified already, normally - the pen simplifies before it commits, so that what goes on the wire
   * is what stays on the board. But this function does not require it, because the guarantee that
   * matters is the one it makes itself: what is stored is within the tolerance the caller simplified
   * with, and a caller that passes raw points gets a stroke with raw points in it.
   */
  readonly points: readonly Point[];
  /** Which of the six colours to draw with. Anything else is refused. */
  readonly color: PenColor;
  /** Which of the three widths to draw at. Anything else is refused. */
  readonly thickness: PenThickness;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

function isPoint(value: Point | undefined): value is Point {
  return value !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function readZ(object: YObject): number {
  const z = object.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/**
 * Highest stacking order of any readable object; 0 for an empty document. The stroke goes one above it,
 * so a line is drawn on top of the shapes it was drawn over - which is what a sketch on a diagram looks
 * like.
 */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map && canReadObjectType(object.get('type'))) {
      max = Math.max(max, readZ(object));
    }
  }
  return max;
}

/** Ids are `crypto.randomUUID()`, so strokes made offline by two peers never collide. */
function newId(): string {
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/** A number small enough to store exactly, and large enough to not be a rounding artefact. */
function stored(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Put a stroke on the board.
 *
 * The path is stored relative to its own box, and the box is the path's bounds padded out by half the
 * pen's thickness on every side: the padding is what makes a stroke one point long into a dot with a
 * box around it rather than a line with no width and no hit area, and it is why the selection outline
 * hugs the drawing instead of cutting the ink off.
 *
 * `baseWidth`/`baseHeight` record the box *at this moment*, and are what every later resize is
 * measured against - see {@link scaledPoints}.
 *
 * One `doc.transact`, whatever the path holds, so a stroke committed at the halfway point of a
 * five-thousand-point drag is one change to the board, one entry in the undo history and one update on
 * the wire.
 *
 * @returns the new id, or `null` for an empty path, a path with a coordinate that is not a number, a
 * colour or width the pen does not have, or a board that cannot say who drew it. A rejected drawing
 * opens no transaction: nothing is written, and nothing arrives at anybody else.
 */
export function createStroke(doc: Y.Doc, drawing: StrokeDrawing, by: string): string | null {
  const points = drawing.points;
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  // Half a path is not a path: one bad coordinate is a capture that went wrong, and a stroke drawn from
  // it would be a line to a place that is not anywhere.
  for (const point of points) {
    if (!isPoint(point)) {
      return null;
    }
  }
  if (!isPenColor(drawing.color) || !isPenThickness(drawing.thickness)) {
    return null;
  }
  if (typeof by !== 'string' || by === '') {
    return null;
  }

  const half = PEN_THICKNESS_WORLD[drawing.thickness] / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const x = minX - half;
  const y = minY - half;
  // Both sides of the padding, which is why a one-point path ends up `thickness` wide rather than zero.
  const width = maxX - minX + half * 2;
  const height = maxY - minY + half * 2;

  const flat: number[] = [];
  for (const point of points) {
    flat.push(stored(point.x - x), stored(point.y - y));
  }

  const id = newId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', STROKE_TYPE);
    object.set('x', stored(x));
    object.set('y', stored(y));
    object.set('width', stored(width));
    object.set('height', stored(height));
    object.set('points', flat);
    object.set('baseWidth', stored(width));
    object.set('baseHeight', stored(height));
    // The colour goes in the field every object keeps its colour in; the reader hands it back as
    // `penColor`, because this one is a drawing colour and not a sticky note's.
    object.set('color', drawing.color);
    object.set('thickness', drawing.thickness);
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stored path as board points: the box's top-left plus each stored offset, scaled by how far the
 * box has been stretched since the stroke was drawn.
 *
 * ```text
 * world = box.origin + stored × (box.size ÷ the box it was drawn at)
 * ```
 *
 * This is where the two halves of story 11's resize rule meet. A stroke's box is dragged by a selection
 * handle like any other object's, and the path is not rewritten to match - it is *read* through this
 * function, so scaling is free, it is the same on every peer the instant the box arrives, and there is
 * no version of the document in which the box and the drawing disagree. It is also the reason a stroke
 * can be attached to an arrow and follow it, and why hit-testing has to come through here too: the
 * stored numbers are not a place on the board until the box is applied to them.
 *
 * A stroke with no usable reference box - one written before the field existed, or by something that
 * did not write it - is drawn at the box it is in (scale 1), which is the only answer that is neither a
 * division by zero nor a drawing that vanished.
 */
export function scaledPoints(stroke: StrokeSnapshot): Point[] {
  const points = stroke.points;
  const scaleX = stroke.baseWidth > 0 ? stroke.width / stroke.baseWidth : 1;
  const scaleY = stroke.baseHeight > 0 ? stroke.height / stroke.baseHeight : 1;
  const path: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (x === undefined || y === undefined) {
      continue;
    }
    path.push({
      x: stroke.x + x * scaleX,
      y: stroke.y + y * scaleY,
    });
  }
  return path;
}

/**
 * How close to a stroke the pointer has to be to be *on* it, in world units, at a given zoom.
 *
 * The wider of half the line's own thickness and {@link STROKE_HIT_TOLERANCE_PX} screen pixels:
 * a thick stroke is a band you aim at the middle of, and a thin one is a hair that you should still be
 * able to click. Dividing the pixel figure by the zoom is what keeps the second half true at every
 * zoom - the same six pixels on the same screen - and taking the max is what stops a zoomed-in thin
 * stroke from becoming a hit area narrower than the ink it is measuring.
 *
 * The invisible wide path the stroke is clicked on is drawn exactly this wide (twice, since a stroke
 * reaches half its width each side of the line), which is why the DOM and this function cannot disagree
 * about where a stroke is clickable.
 */
export function strokeHitTolerance(stroke: StrokeSnapshot, zoom: number): number {
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness] / 2;
  const pixels = Number.isFinite(zoom) && zoom > 0 ? STROKE_HIT_TOLERANCE_PX / zoom : STROKE_HIT_TOLERANCE_PX;
  return Math.max(thickness, pixels);
}

/**
 * The stroke a snapshot holds, or `null` when the object is not a stroke.
 *
 * The four fields a stroke needs are the four the board's reader already hands up whenever it read the
 * object as a stroke at all; this narrows the type for callers that were given an {@link ObjectSnapshot}
 * and need to know they can trust it, and fills in the two defaults - a colour or a width from a later
 * version of the product draws the stroke in black and medium rather than not at all. The exception is
 * the path, whose absence the board's reader has already turned into "no stroke".
 *
 * This is also where the colour changes its name: the document keeps every object's colour in `color`,
 * the generic snapshot reports a stroke's as `penColor` because its own `color` is typed as a sticky
 * note's, and here it goes back to being `color`, which is the type a drawing colour has.
 */
export function asStrokeSnapshot(object: ObjectSnapshot): StrokeSnapshot | null {
  if (object.type !== STROKE_TYPE || !canReadObjectType(STROKE_TYPE)) {
    return null;
  }
  return {
    ...object,
    type: STROKE_TYPE,
    color: isPenColor(object.penColor) ? object.penColor : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(object.thickness) ? object.thickness : DEFAULT_PEN_THICKNESS,
    points: object.points ?? [],
    baseWidth: object.baseWidth !== undefined && object.baseWidth > 0 ? object.baseWidth : object.width,
    baseHeight:
      object.baseHeight !== undefined && object.baseHeight > 0 ? object.baseHeight : object.height,
  };
}

/** The width a stroke's line is drawn at, in world units. */
export function strokeThicknessWorld(stroke: StrokeSnapshot): number {
  return PEN_THICKNESS_WORLD[stroke.thickness];
}
