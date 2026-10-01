// The stroke object: the line a Pen drag drew (story 11).
//
// A stroke is a board object like any other - the same `objects` map, the same
// transaction discipline, so story 7's select/move/resize/delete, story 8's undo
// and story 3's sync apply to it without new plumbing. What is its own is what it
// stores: not a box and a colour, but the line.
//
// The line is stored as `[x0, y0, x1, y1, ...]`, in board units *relative to the
// box's own origin*, together with the box's size at the moment it was drawn
// (`baseWidth`, `baseHeight`). That is what makes a resize scale a drawing instead
// of shearing it: `scaledPoints` multiplies the stored numbers by however many
// times bigger the box has become, so a stroke dragged twice as wide is the same
// drawing twice as big. A stroke stored in absolute board coordinates could not
// say which of its points had to move when its box moved.
//
// The box is the drawing's bounds padded by half the line's thickness, so the
// stroke's own ink is inside the box that holds it and the resize handle a person
// drags is on the ink's edge rather than a hair outside it. A tap is the one
// drawing with no extent: its box is one thickness square, and the round cap of
// the path drawn in it is the dot.

import * as Y from 'yjs';
import { LOCAL_ORIGIN, newObjectId } from '../board-model.js';
import type { ObjectSnapshot } from '../board-model.js';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  TYPE_STROKE,
  type PenColor,
  type PenThickness,
} from '../config.js';
import type { Point, Rect } from '../geometry.js';

export type { PenColor, PenThickness };

export interface StrokeSnapshot extends ObjectSnapshot {
  type: 'stroke';
  /** The line, as [x0, y0, x1, y1, ...] relative to the box's origin. */
  points: readonly number[];
  /** A stroke's box is always its own: there is no default size for a drawing. */
  width: number;
  height: number;
  /** The box's size when the line was drawn: what a resize scales against. */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  createdAt: number;
  createdBy: string | null;
}

/** The design's name for the same snapshot. */
export type StrokeSnap = StrokeSnapshot;

/** The stroke's line, in board units, as the pen left it. */
export interface StrokeDraw {
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

const COLORS = PEN_COLORS as Record<string, string>;
const THICKNESSES = PEN_THICKNESS_WORLD as Record<string, number>;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLORS, value);
}

function isThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THICKNESSES, value);
}

/** The largest z on the board, over every type, or 0 for an empty one. */
function topZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const object of objects.values()) {
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/**
 * The box a drawing is drawn in: its bounds, grown by half a thickness on every
 * side so the ink's own width is inside it. One point - a tap - has no bounds of
 * its own, and the padding alone is what gives it a box: one thickness square.
 */
function boxOf(points: readonly Point[], thicknessWorld: number): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const inset = thicknessWorld / 2;
  return {
    x: x0 - inset,
    y: y0 - inset,
    width: x1 - x0 + thicknessWorld,
    height: y1 - y0 + thicknessWorld,
  };
}

/**
 * Draw a stroke. `a.points` is the simplified line, in board units, where the pen
 * left it; `by` is who drew it.
 *
 * Validation is all before anything is written, and a request that fails it opens
 * no transaction at all and returns null: a half-stored stroke would be a drawing
 * nobody can see, select or delete. A stroke of one point is a dot, and a stroke
 * whose points are all the same place is a dot too.
 */
export function createStroke(
  doc: Y.Doc,
  a: StrokeDraw,
  by: string,
): string | null {
  if (a === null || typeof a !== 'object') return null;
  if (!isColor(a.color) || !isThickness(a.thickness)) return null;
  const raw = a.points;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  for (const p of raw) {
    if (p === null || typeof p !== 'object') return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  const thicknessWorld = THICKNESSES[a.thickness];
  const box = boxOf(raw, thicknessWorld);
  const points: number[] = [];
  for (const p of raw) {
    points.push(p.x - box.x, p.y - box.y);
  }

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = newObjectId();
  const z = topZ(objects) + 1;
  const who = typeof by === 'string' ? by : null;

  doc.transact(() => {
    const stroke = new Y.Map<unknown>();
    stroke.set('type', TYPE_STROKE);
    stroke.set('x', box.x);
    stroke.set('y', box.y);
    stroke.set('width', box.width);
    stroke.set('height', box.height);
    stroke.set('baseWidth', box.width);
    stroke.set('baseHeight', box.height);
    stroke.set('points', points);
    stroke.set('color', a.color);
    stroke.set('thickness', a.thickness);
    stroke.set('z', z);
    stroke.set('createdAt', Date.now());
    if (who !== null) stroke.set('createdBy', who);
    objects.set(id, stroke);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * The line as it is drawn now: the stored numbers, scaled by however much the box
 * has grown since the line was drawn and moved into board coordinates.
 *
 * A stroke nobody has resized scales by exactly 1 and comes back where it was
 * drawn. A stroke whose stored base is unusable - damage from somewhere else on
 * the board - is drawn as it was stored rather than not at all, because a drawing
 * you can see is better than a drawing you cannot.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const baseWidth = finite(s.baseWidth) ?? finite(s.width) ?? 0;
  const baseHeight = finite(s.baseHeight) ?? finite(s.height) ?? 0;
  if (baseWidth <= 0 || baseHeight <= 0) return [];
  const width = finite(s.width) ?? baseWidth;
  const height = finite(s.height) ?? baseHeight;
  if (baseWidth <= 0 || baseHeight <= 0) return [];

  const sx = width / baseWidth;
  const sy = height / baseHeight;
  const points: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    const px = s.points[i]!;
    const py = s.points[i + 1]!;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    points.push({ x: s.x + px * sx, y: s.y + py * sy });
  }
  return points;
}

/**
 * Read one object entry. A stroke of a thickness or colour this build does not
 * know is drawn in the default - a colour is only a colour, and hiding somebody's
 * drawing to lose it is the wrong trade. A stroke whose *line* is damaged is not
 * drawn at all, because there is no drawing to fall back to.
 */
export function readStroke(id: string, object: Y.Map<unknown>): StrokeSnapshot | null {
  if (object.get('type') !== TYPE_STROKE) return null;
  const x = finite(object.get('x'));
  const y = finite(object.get('y'));
  const z = finite(object.get('z'));
  const width = finite(object.get('width'));
  const height = finite(object.get('height'));
  if (x === null || y === null || z === null || width === null || height === null) return null;

  const stored = object.get('points');
  if (!Array.isArray(stored) || stored.length < 2 || stored.length % 2 !== 0) return null;
  const points: number[] = [];
  for (const value of stored) {
    const n = finite(value);
    if (n === null) return null; // a line with a hole in it is not the line
    points.push(n);
  }

  // The size the line was drawn at. A stroke written before this field meant
  // anything - or written by something that forgot it - is drawn at its current
  // size, which scales it by 1 and is the only honest reading of it.
  const baseWidth = finite(object.get('baseWidth')) ?? width;
  const baseHeight = finite(object.get('baseHeight')) ?? height;
  if (baseWidth <= 0 || baseHeight <= 0) return null;

  const color = object.get('color');
  const thickness = object.get('thickness');
  const createdAt = finite(object.get('createdAt'));
  const createdBy = object.get('createdBy');
  return {
    id,
    type: TYPE_STROKE,
    x,
    y,
    width,
    height,
    z,
    points,
    baseWidth,
    baseHeight,
    color: isColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
    createdAt: createdAt ?? 0,
    createdBy: typeof createdBy === 'string' ? createdBy : null,
  };
}

/** Every stroke on the board, in the order it was drawn. */
export function strokeSnapshots(doc: Y.Doc): readonly StrokeSnapshot[] {
  const strokes: StrokeSnapshot[] = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((object, id) => {
    if (!(object instanceof Y.Map)) return;
    const stroke = readStroke(id, object);
    if (stroke !== null) strokes.push(stroke);
  });
  return strokes;
}

/** One stroke by id, or null when it is gone or unreadable. */
export function strokeSnapshot(doc: Y.Doc, id: string): StrokeSnapshot | null {
  if (typeof id !== 'string' || id === '') return null;
  const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return object instanceof Y.Map ? readStroke(id, object) : null;
}

/** A stroke's own thickness, in board units, for drawing and for hitting. */
export function strokeThicknessWorld(s: StrokeSnap): number {
  return PEN_THICKNESS_WORLD[s.thickness];
}

/** A stroke's colour, as CSS sees it. */
export function strokeColor(s: StrokeSnap): string {
  return PEN_COLORS[s.color];
}
