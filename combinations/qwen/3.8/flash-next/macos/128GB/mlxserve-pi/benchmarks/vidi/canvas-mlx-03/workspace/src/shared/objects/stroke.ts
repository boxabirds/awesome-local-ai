// The stroke object model (story 11 `stroke.model`): the Yjs schema for one finished
// freehand stroke and the two operations on it that are not generic.
//
// Schema (one entry in the shared `objects` map):
//   objects/<id>: Y.Map {
//     type: 'stroke', x, y, width, height, z, createdAt, createdBy,
//     points: number[]      // flattened [x0, y0, x1, y1, ...], relative to the bbox
//                           //   origin, at the size the stroke was created at
//     baseWidth, baseHeight,// the bbox size at creation; render scale = width/baseWidth
//     color: PenColor, thickness: PenThickness
//   }
//
// A stroke is *immutable after it is created*: the only writes it ever takes are the
// generic x / y / width / height of story 7 and the generic delete. That is why `points`
// is one plain array replaced atomically rather than a `Y.Array` edited point by point —
// nobody ever edits a point, so nothing needs per-point merging — and why resizing needs
// no stroke-specific code at all: story 7 writes a new width and height, and
// `scaledPoints` maps the stored points into it, which is what keeps a sketch's
// proportions while its thickness stays the thickness it was drawn with (pen.resize).
//
// The bbox is padded by half the thickness on every side, so what is painted always lies
// inside the box the selection, the marquee and the resize handles work on.

import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectSnapshots, type ObjectSnapshot } from '../board-model.ts';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../config.ts';
import type { Point, Rect } from '../geometry.ts';
import { distanceToPolyline } from '../geometry/polyline.ts';

const STROKE_TYPE = 'stroke';

/** The six pen colours and the three thicknesses, as names. */
export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** A stroke as the client renders it: the generic fields plus the stroke's own. */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...], relative to (x, y) at creation size. */
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  width: number;
  height: number;
  createdBy: string;
}

/** What the Pen tool hands `createStroke` when a stroke ends. */
export interface StrokeCreateArgs {
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

const COLORS = PEN_COLORS as Readonly<Record<string, string>>;
const THICKNESSES = PEN_THICKNESS_WORLD as Readonly<Record<string, number>>;

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The highest z across every object, or 0 when none. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let m = 0;
  for (const o of objects.values()) {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > m) m = z;
  }
  return m;
}

/** A usable positive size, or undefined when the stored value is unusable. */
function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Is this value one of the six pen colour names? */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLORS, value);
}

/** Is this value one of the three pen thickness names? */
export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THICKNESSES, value);
}

/** A colour name is rendered as its paint; an unknown name renders as nothing. */
export function penPaint(name: unknown): string | undefined {
  return isPenColor(name) ? COLORS[name] : undefined;
}

/** A thickness name is its width in board units; an unknown one falls back. */
export function penThickness(name: unknown): number {
  return isPenThickness(name) ? THICKNESSES[name] : THICKNESSES[DEFAULT_PEN_THICKNESS];
}

/**
 * The stroke's own fields, read out of a generic snapshot the board already has. An
 * unusable `points` array comes back empty, which renders nothing and hits nothing:
 * a stroke nobody can draw is never selected either.
 */
export function asStrokeSnapshot(o: ObjectSnapshot): StrokeSnap {
  return {
    ...o,
    type: STROKE_TYPE,
    points: storedPoints(o.points),
    baseWidth: positive(o.baseWidth) ?? 1,
    baseHeight: positive(o.baseHeight) ?? 1,
    color: isPenColor(o.color) ? o.color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(o.thickness) ? o.thickness : DEFAULT_PEN_THICKNESS,
    width: positive(o.width) ?? 1,
    height: positive(o.height) ?? 1,
    createdBy: o.createdBy ?? '',
  };
}

/** The strokes in a snapshot list, in the same (stacking) order. */
export function strokesOf(objects: readonly ObjectSnapshot[]): StrokeSnap[] {
  const out: StrokeSnap[] = [];
  for (const o of objects) if (o.type === STROKE_TYPE) out.push(asStrokeSnapshot(o));
  return out;
}

/** Every stroke in the document, in stacking order. */
export function strokeSnapshots(doc: Y.Doc): readonly StrokeSnap[] {
  return strokesOf(objectSnapshots(doc));
}

/** One stroke's full snapshot, or undefined for a stale / non-stroke id. */
export function strokeSnapshot(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const found = objectSnapshots(doc).find((o) => o.id === id && o.type === STROKE_TYPE);
  return found ? asStrokeSnapshot(found) : undefined;
}

/**
 * Create a finished stroke from the points the pen recorded, and return its id — or null,
 * writing nothing at all, when the points are empty or hold a coordinate that is not a
 * number, or when the colour or thickness is not a name the palette knows (pen.options).
 *
 * One successful call is one `LOCAL_ORIGIN` transaction: one update on the wire, one undo
 * step, and nothing a colleague can see before the pen left the board.
 *
 * The box is the points' own box padded by half the thickness on every side, so the paint
 * always lies inside the box the selection, the marquee and the resize handles are drawn
 * on; `points` is stored relative to that padded box, at the size it is created at, and
 * `baseWidth`/`baseHeight` remember the size so a later resize has something to scale by.
 */
export function createStroke(
  doc: Y.Doc,
  a: StrokeCreateArgs,
  by: string,
): string | null {
  const points: Point[] = [];
  if (Array.isArray(a?.points)) {
    for (const p of a.points) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      points.push({ x: p.x, y: p.y });
    }
  }
  if (points.length === 0) return null;
  const color = a?.color;
  const thickness = a?.thickness;
  if (!isPenColor(color) || !isPenThickness(thickness)) return null;

  // Half the thickness of padding, so a thick stroke's box is thicker than its line.
  const pad = THICKNESSES[thickness] / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = r2(minX - pad);
  const y = r2(minY - pad);
  const width = Math.max(r2(maxX - minX) + pad * 2, MIN_EXTENT);
  const height = Math.max(r2(maxY - minY) + pad * 2, MIN_EXTENT);

  // Flattened [x0, y0, x1, y1, ...] relative to (x, y): the whole stroke in one array,
  // which is what lets it be written once and replaced whole.
  const flat: number[] = [];
  for (const p of points) {
    flat.push(r2(p.x - x), r2(p.y - y));
  }

  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const o = new Y.Map<unknown>();
    o.set('type', STROKE_TYPE);
    o.set('x', x);
    o.set('y', y);
    o.set('width', width);
    o.set('height', height);
    o.set('points', flat);
    o.set('baseWidth', width);
    o.set('baseHeight', height);
    o.set('color', color);
    o.set('thickness', thickness);
    o.set('z', maxZ(objects) + 1);
    o.set('createdAt', Date.now());
    if (typeof by === 'string' && by !== '') o.set('createdBy', by);
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The points as they are drawn *now*: the stored points scaled by the object's current
 * width and height against the size it was created at, moved into board space. This is
 * what a proportional resize costs — nothing written to `points`, one read that follows
 * whatever story 7 wrote to `width` and `height` (pen.resize). A size that is unusable
 * scales by 1 rather than collapsing the stroke to a point.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const flat = storedPoints(s?.points);
  const out: Point[] = [];
  if (flat.length === 0) return out;
  const sx = scaleOf(s.width, s.baseWidth);
  const sy = scaleOf(s.height, s.baseHeight);
  const x = finite(s.x) ? s.x : 0;
  const y = finite(s.y) ? s.y : 0;
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: x + flat[i] * sx, y: y + flat[i + 1] * sy });
  return out;
}

/**
 * Is this board point on the stroke? Its *line*, within the larger of half its thickness
 * and the click tolerance converted to board units at the current zoom — 6 screen pixels
 * are 12 board units at 50% zoom and 3 at 200%. A click inside the stroke's box but away
 * from its line is not on it, which is what lets a note under a large scribble be clicked
 * (pen.select).
 *
 * A single point stroke is a dot, and `distanceToPolyline` measures polylines of at least
 * two points, so the dot is measured to itself.
 */
export function strokeHitTest(obj: ObjectSnapshot, worldPoint: Point, zoom = 1): boolean {
  const stroke = asStrokeSnapshot(obj);
  const points = scaledPoints(stroke);
  if (points.length === 0) return false;
  if (!worldPoint || !Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) return false;
  const z = finite(zoom) && zoom > 0 ? zoom : 1;
  const clickTolerance = STROKE_HIT_TOLERANCE_PX / z;
  const halfThickness = penThickness(stroke.thickness) / 2;
  const tolerance = Math.max(halfThickness, clickTolerance);
  if (points.length === 1) {
    return Math.hypot(worldPoint.x - points[0].x, worldPoint.y - points[0].y) <= tolerance;
  }
  return distanceToPolyline(points, worldPoint) <= tolerance;
}

/** The stroke's box, padded side by side. */
export function strokeBounds(s: StrokeSnap): Rect {
  return { x: s.x, y: s.y, width: s.width, height: s.height };
}

/** How far a coordinate may be scaled before it is a stroke nobody can see. */
const MIN_EXTENT = 0.01;

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The render scale of one axis: 1 unless both sizes are usable positive numbers. */
function scaleOf(size: number | undefined, base: number | undefined): number {
  if (!finite(size) || !finite(base) || size <= 0 || base <= 0) return 1;
  return size / base;
}

/** The stored points as numbers, or nothing usable. */
function storedPoints(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return [];
    out.push(v);
  }
  // A half-point at the end is a corrupt write, not a stroke: render nothing.
  if (out.length % 2 !== 0) return [];
  return out;
}
