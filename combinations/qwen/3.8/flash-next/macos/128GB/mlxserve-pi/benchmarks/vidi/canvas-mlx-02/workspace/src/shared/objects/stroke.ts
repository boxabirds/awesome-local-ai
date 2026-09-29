// The stroke object (story 11, design `stroke.model`): a line somebody drew with
// the pen. It lives in the SAME `objects` map as the sticky note, the shape and the
// free text, so story 7's select / move / resize / z-order and story 8's undo act on
// it without ever having heard of a pen.
//
// What is STORED is an ordinary box plus the drawn path RELATIVE to that box,
// recorded at the size it was drawn at (`baseWidth`/`baseHeight`). That is the one
// decision that makes a stroke an object: resizing writes x/y/width/height like any
// other object - one transaction, one undo step - and `scaledPoints` turns the box
// back into the line. The line's own weight is NOT scaled, because the thickness is
// a property of the pen, not of what was drawn.
//
// Every write is one LOCAL_ORIGIN transaction, and every refusal is decided BEFORE a
// transaction is opened, so a refused write emits zero update events.
import * as Y from 'yjs';
import type { Point, Rect } from '../geometry.ts';
import { MAX_OBJECT_SIZE_WORLD, PEN_COLORS, PEN_THICKNESS_WORLD } from '../config.ts';
import type { PenColor, PenThickness } from '../config.ts';
import { LOCAL_ORIGIN, objectsMapOf } from '../board-model.ts';
import type { ObjectSnapshot } from '../board-model.ts';

export type { PenColor, PenThickness } from '../config.ts';

/** The one type string this object is stored under. */
export const STROKE_TYPE = 'stroke';

// A stroke's own fields on top of the generic object snapshot. `points` is the path
// flattened to [x0, y0, x1, y1, ...] RELATIVE to the box origin, so the render scale
// is width / baseWidth by height / baseHeight.
export interface StrokeSnapshot extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/** The design's shorter name for the same snapshot. */
export type StrokeSnap = StrokeSnapshot;

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Is `v` one of the six pen colours? */
export function isPenColor(v: unknown): v is PenColor {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, v);
}

/** Is `v` one of the three pen thicknesses? */
export function isPenThickness(v: unknown): v is PenThickness {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, v);
}

/**
 * Is this snapshot a stroke, with the fields a stroke needs? The board model reader
 * validates every one of them, so this is the cast the registry and the components
 * narrow through instead of asserting.
 */
export function isStrokeSnapshot(obj: ObjectSnapshot | null | undefined): obj is StrokeSnapshot {
  return (
    !!obj &&
    obj.type === STROKE_TYPE &&
    Array.isArray(obj.points) &&
    isPenColor(obj.color) &&
    isPenThickness(obj.thickness) &&
    isCoord(obj.baseWidth) &&
    obj.baseWidth > 0 &&
    isCoord(obj.baseHeight) &&
    obj.baseHeight > 0
  );
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMapOf(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * The box a path describes, with half the line thickness added on EVERY side so the
 * box holds the ink rather than the centre line. A single point - a pen that was
 * clicked and never moved - becomes a square the diameter of the thickness, which is
 * what makes a dot a selectable, resizable object instead of an invisible point.
 */
export function strokeBox(points: readonly Point[], thicknessWorld: number): Rect {
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = minX;
  let maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - thicknessWorld / 2,
    y: minY - thicknessWorld / 2,
    width: Math.min(maxX - minX + thicknessWorld, MAX_OBJECT_SIZE_WORLD),
    height: Math.min(maxY - minY + thicknessWorld, MAX_OBJECT_SIZE_WORLD),
  };
}

/**
 * Draw a stroke: one LOCAL_ORIGIN transaction, and its id.
 *
 * `points` is the path in WORLD coordinates (the Pen tool has already smoothed it);
 * `color` and `thickness` are the pen's product names. The stroke lands on top of
 * every other object, like everything else that gets created.
 *
 * Anything it cannot draw returns null and opens NO transaction at all: no points, a
 * point that is not a number anywhere in the path (a half-broken path is refused, not
 * quietly shortened - the alternative is a stroke that draws the wrong thing), a
 * colour that is not a pen colour, a thickness that is not one of the three.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  createdBy: string,
): string | null {
  if (!a || !Array.isArray(a.points) || a.points.length === 0) return null;
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  for (const p of a.points) {
    if (!p || !isCoord(p.x) || !isCoord(p.y)) return null;
  }

  const thicknessWorld = PEN_THICKNESS_WORLD[a.thickness];
  const box = strokeBox(a.points, thicknessWorld);
  // The path is stored relative to the box it belongs to, at two decimals: a point
  // of a drawn line is never further apart from its neighbour than a hundredth of a
  // board unit matters.
  const rel: number[] = [];
  for (const p of a.points) {
    rel.push(Math.round((p.x - box.x) * 100) / 100, Math.round((p.y - box.y) * 100) / 100);
  }
  const id = crypto.randomUUID();
  const now = Date.now();

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', STROKE_TYPE);
    m.set('x', box.x);
    m.set('y', box.y);
    m.set('width', box.width);
    m.set('height', box.height);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', now);
    m.set('createdBy', createdBy);
    m.set('color', a.color);
    m.set('thickness', a.thickness);
    m.set('baseWidth', box.width);
    m.set('baseHeight', box.height);
    m.set('points', rel);
    objectsMapOf(doc).set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Where the stroke's points are NOW, in world coordinates: every recorded point
 * scaled by how much its box has been resized since it was drawn.
 *
 * This is the whole reason a stroke can be resized with story 7's machinery: the
 * resize writes a box and nothing else, and the drawing follows it. A box that cannot
 * be scaled - no size, a base size of nothing, a path that is not a path - yields no
 * points at all, so nothing draws and nothing throws.
 */
export function scaledPoints(stroke: StrokeSnapshot): Point[] {
  if (!stroke) return [];
  const width = isCoord(stroke.width) ? stroke.width : Number.NaN;
  const height = isCoord(stroke.height) ? stroke.height : Number.NaN;
  // A box with no size has nothing to draw: no path rather than a path crushed to
  // the box origin.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const baseWidth = isCoord(stroke.baseWidth) ? stroke.baseWidth : 0;
  const baseHeight = isCoord(stroke.baseHeight) ? stroke.baseHeight : 0;
  const sx = width / baseWidth;
  const sy = height / baseHeight;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return [];

  const flat = stroke.points;
  if (!Array.isArray(flat) || flat.length % 2 !== 0) return [];
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i];
    const y = flat[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    out.push({ x: stroke.x + x * sx, y: stroke.y + y * sy });
  }
  return out;
}
