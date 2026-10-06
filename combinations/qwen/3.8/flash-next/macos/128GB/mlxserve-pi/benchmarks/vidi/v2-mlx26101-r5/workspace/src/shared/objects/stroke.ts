/**
 * The stroke object: what a finished pen stroke is made of (story 11).
 *
 * A stroke is a freehand mark — a circle drawn round a cluster of notes, an underline, a sketch of an
 * arrow — and once it is finished it is an ordinary board object: listed by the snapshot, selected by
 * story 7's selection, moved and resized by story 7's handles, deleted by the Delete key, undone by story
 * 8's history, carried to other people by story 3's sync. Nothing below knows about the pointer that drew
 * it or the tool that committed it; what is here is the shape of the thing a finished stroke leaves
 * behind, which is:
 *
 * - `points`: the line itself, flattened into `[x0, y0, x1, y1, …]` and stored **relative to the object's
 *   own top-left**, at the size the object was created at. Relative, because then a move writes two
 *   numbers instead of two hundred; at creation size, because a resize writes two more (`width`,
 *   `height`) and the line follows them by arithmetic. The array is replaced whole and never edited
 *   point-by-point, which is what lets it be a plain `number[]` in the `Y.Map` rather than a shared type:
 *   strokes are immutable once drawn, so there is nothing for a merge to reconcile.
 * - `baseWidth` / `baseHeight`: the box the line was drawn into. They are the denominator of
 *   {@link scaledPoints}, and the reason a proportional resize needs nothing of its own — the object is
 *   resized by the story 7 gesture like anything else, and the line is a function of its box.
 * - `color` / `thickness`: the two choices the pen toolbar offered, stored as the *names* the toolbar
 *   used, so that a stroke drawn yesterday in `red` is still drawn in the red of today's palette, and so
 *   that picking a new colour changes the next stroke and never the last one.
 *
 * Every write is a `doc.transact(fn, LOCAL_ORIGIN)` like every other type's: one finished stroke is one
 * transaction, which is one update to the room and one step of the undo history.
 */

import * as Y from 'yjs';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { LOCAL_ORIGIN, OBJECTS_MAP, initDoc, type ObjectSnapshot } from '../board-model';
export const STROKE_OBJECT_TYPE = 'stroke';

/** The two names a stroke is drawn with, re-exported beside {@link StrokeSnapshot} for one import. */
export type { PenColor, PenThickness } from '../config';

/**
 * One finished stroke, as the snapshot reads it.
 *
 * What the design calls `StrokeSnap`, in as many fields as it names: the four numbers every object has, the
 * line in units relative to the box's top-left, the box the line was drawn at, and the two choices it was
 * drawn with. It is called `StrokeSnapshot` rather than `StrokeSnap` for the same reason `ShapeSnapshot` and
 * `ConnectorSnapshot` are: every other snapshot in this codebase is, and a pen should not be the exception.
 */
export interface StrokeSnapshot extends ObjectSnapshot {
  type: 'stroke';
  /** `[x0, y0, x1, y1, …]`, relative to (`x`, `y`) and at `baseWidth` × `baseHeight`. */
  points: readonly number[];
  /** The box the line was drawn into: what `width` is scaled from. */
  baseWidth: number;
  baseHeight: number;
  /** A name from `PEN_COLORS`. */
  color: PenColor;
  /** A name from `PEN_THICKNESS_WORLD`. */
  thickness: PenThickness;
}

/** The object is a stroke. */
export const isStrokeSnapshot = (object: ObjectSnapshot | null | undefined): object is StrokeSnapshot =>
  object !== null && object !== undefined && object.type === STROKE_OBJECT_TYPE;

/** A colour the pen draws. */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

/** A thickness the pen draws. */
export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

/** The colour a name is drawn in, or the default for a name this build has no ink for. */
export const strokeColorOf = (color: unknown): string =>
  isPenColor(color) ? PEN_COLORS[color] : PEN_COLORS[DEFAULT_PEN_COLOR];

/** How thick a name is drawn, in world units. */
export const penThicknessWorld = (thickness: unknown): number =>
  isPenThickness(thickness) ? PEN_THICKNESS_WORLD[thickness] : PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];

/** What {@link createStroke} is asked for. */
export interface CreateStrokeInput {
  /** The line, in world units. Empty, or with a coordinate that is not a number, is refused. */
  points: readonly Point[];
  /** Which of the six colours. An unknown name is refused. */
  color?: PenColor;
  /** Which of the three thicknesses. An unknown name is refused. */
  thickness?: PenThickness;
}

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => {
  if (typeof doc?.getMap !== 'function') {
    throw new TypeError('a Y.Doc is required');
  }
  initDoc(doc);
  return doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const numberOr = (value: unknown, fallback: number): number => (finite(value) ? value : fallback);

/** The top of the stack, over every object of every type: a stroke is drawn above what it was drawn round. */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objectsOf(doc).forEach((value) => {
    if (value instanceof Y.Map) top = Math.max(top, numberOr(value.get('z'), 0));
  });
  return top;
}

/**
 * Writes a finished stroke and returns its id, or null when nothing was written.
 *
 * The validation is first and it is silent, for the reason story 10 found with the shape label: a write
 * that is refused after its transaction is opened leaves a step in the history that undoes nothing, so the
 * person pressing ⌘Z sees nothing happen and presses it again. Every number in the path is checked before
 * a map is created, and a rejected stroke costs no step at all.
 *
 * A colour or a thickness this build has no ink for is refused rather than written: the names are the
 * toolbar's, and a document that drifts into holding `chartreuse` is one that draws two different strokes
 * for one setting. (The read side is still forgiving — see {@link strokeColorOf} — because a stroke that
 * arrived from a newer client is not this client's to break.)
 *
 * The box is the union of the **raw** points, padded by half the ink on every side. The padding is what
 * stops a stroke from being drawn to the edge of its own box with half its ink outside it, and for one
 * point — a click, which is a dot — the padding is the whole of the box: as wide as the pen, which is the
 * only honest size a dot has.
 *
 * One transaction, like every other creation here: a stroke is an object, not a sequence of ones.
 */
export function createStroke(
  doc: Y.Doc,
  input: CreateStrokeInput,
  by = '',
): string | null {
  const points = input.points;
  if (!Array.isArray(points) || points.length === 0) return null; // nothing was drawn
  for (const point of points) {
    if (point === null || point === undefined) return null;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  }
  if (input.color !== undefined && !isPenColor(input.color)) return null;
  if (input.thickness !== undefined && !isPenThickness(input.thickness)) return null;

  const color = input.color ?? DEFAULT_PEN_COLOR;
  const thickness = input.thickness ?? DEFAULT_PEN_THICKNESS;
  const ink = penThicknessWorld(thickness);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  const pad = ink / 2;
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;

  // Relative to the box's top-left, which is what makes moving a stroke a write of two numbers rather
  // than of two hundred, and flat, because a `Y.Array` of two thousand shared items would be a shared type
  // with nothing to share: this array is replaced whole or not at all.
  const flat: number[] = [];
  for (const point of points) flat.push(point.x - x, point.y - y);

  const objects = objectsOf(doc);
  const id = crypto.randomUUID();
  const map = new Y.Map<unknown>();
  const createdAt = Date.now();

  doc.transact(() => {
    map.set('type', STROKE_OBJECT_TYPE);
    map.set('x', x);
    map.set('y', y);
    map.set('width', width);
    map.set('height', height);
    map.set('z', maxZ(doc) + 1);
    map.set('createdAt', createdAt);
    map.set('createdBy', by);
    map.set('points', flat);
    // The box the line was drawn into, which is the denominator every later render scales against. It is
    // written here and never written again: the line a person drew is the line they drew, whatever the
    // handles are later dragged to.
    map.set('baseWidth', width);
    map.set('baseHeight', height);
    map.set('color', color);
    map.set('thickness', thickness);
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The line where the object is now, at the size the object is now.
 *
 * The points are stored against the box the stroke was drawn into, so reading them means adding the box's
 * position and scaling by the box's growth — the current size over the size it was drawn at. A stroke
 * dragged twice as wide is therefore drawn from the same two hundred numbers it was drawn from the moment
 * the pen lifted, and its *thickness* is unchanged: how thick the pen was is a choice, not a property of
 * the shape, and an enlarged sketch is the same sketch drawn with the same pen.
 *
 * A base size of 0 — or a document written by a client that stored none — is drawn 1:1 against the box
 * rather than at `Infinity`, which is the same deal story 10 makes for a shape whose base size went
 * missing. A stored number that is not a number, and a final half-point left over by a writer that stopped
 * mid-pair, are both left out rather than drawn as `NaN`: one unusable coordinate should drop one point, not
 * take the whole path and the selection box drawn round it with it.
 */
export function scaledPoints(stroke: StrokeSnapshot): Point[] {
  const stored: unknown = stroke.points;
  if (!Array.isArray(stored)) return [];
  const originX = Number.isFinite(stroke.x) ? stroke.x : 0;
  const originY = Number.isFinite(stroke.y) ? stroke.y : 0;
  const sx = scaleOf(stroke.width, stroke.baseWidth);
  const sy = scaleOf(stroke.height, stroke.baseHeight);

  const points: Point[] = [];
  for (let index = 0; index + 1 < stored.length; index += 2) {
    const px: unknown = stored[index];
    const py: unknown = stored[index + 1];
    if (typeof px !== 'number' || typeof py !== 'number') continue;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    points.push({ x: originX + px * sx, y: originY + py * sy });
  }
  return points;
}

/** How much bigger a box has grown than the box it was drawn in: 1 when either size is unusable. */
function scaleOf(now: number | undefined, drawn: number | undefined): number {
  if (now === undefined || drawn === undefined) return 1;
  if (!Number.isFinite(now) || !Number.isFinite(drawn) || drawn <= 0) return 1;
  return now / drawn;
}

/**
 * How near a click has to be, in world units, to be on this stroke's line at this zoom.
 *
 * The rule is the line plus whichever margin is wider: half the ink, because all of the ink is clickable
 * and not only its centre; or `STROKE_HIT_TOLERANCE_PX` screen pixels, so that a line drawn with the
 * thinnest pen is still something a person can point at. The pixel margin is divided by the zoom because a
 * screen pixel is a fixed number of world units only once the zoom is known — 3 world units at 200 %, 12 at
 * 50 %, which is how a fine stroke stays about as easy to hit when it is drawn small as when it is drawn
 * large.
 *
 * A zoom that is not a zoom gets +Infinity, which selects nothing: a board that cannot say how far away it
 * is does not get to select things by accident. The zoom arrives through `ObjectHttpContext`, which is
 * where story 10 put it for arrows.
 */
export function strokeHitRadius(stroke: StrokeSnapshot, zoom: number): number {
  const ink = penThicknessWorld(stroke.thickness);
  if (!Number.isFinite(zoom) || zoom <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(ink / 2, STROKE_HIT_TOLERANCE_PX / zoom);
}
