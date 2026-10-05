/**
 * Stroke object model (story 11).
 *
 * Schema:
 *   objects/<id>: Y.Map {
 *     type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *     points: number[]         // flattened [x0, y0, x1, y1, ...] relative to
 *                              // the bbox origin, at creation size
 *     baseWidth, baseHeight,   // bbox size at creation; render scale =
 *                              // width/baseWidth, height/baseHeight
 *     color: PenColor, thickness: PenThickness
 *   }
 *
 * A stroke is immutable after creation: the points array is replaced atomically
 * (never edited point-by-point) and only the generic x/y/width/height change
 * through story 7's move and resize. That is why the points live *inside* the
 * object's Y.Map as a plain array: one write, one sync payload, no per-point
 * CRDT overhead a stroke will never use.
 *
 * Rules inherited from `board-model.ts`: every successful mutation is exactly
 * one `LOCAL_ORIGIN` transaction, and invalid input is rejected *before* a
 * transaction opens so nothing reaches the wire.
 */
import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot, type StrokeObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };

/** What the renderer reads for one stroke (the contract's name). */
export type StrokeSnap = StrokeObjectSnapshot;

/** The common object fields, spelled as the design does. */
export type ObjectSnap = ObjectSnapshot;

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Is this one of the six pen colours? */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.hasOwn(PEN_COLORS, value);
}

/** Is this one of the three pen thicknesses? */
export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.hasOwn(PEN_THICKNESS_WORLD, value);
}

/** Highest `z` in the document (0 when it holds no objects). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

/**
 * Add a finished stroke.
 *
 * `points` are world-space, already simplified; the bbox is their extent padded
 * by half the thickness so the round caps stay inside the object's own
 * rectangle. A single point gets a thickness-sized square — the dot — with the
 * point stored at its centre.
 *
 * Returns the new id, or `null` — without opening a transaction — for empty or
 * non-finite points or an unknown colour or thickness.
 */
export function createStroke(
  doc: Y.Doc,
  { points, color, thickness }: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  for (const p of points) {
    if (!p || !finite(p.x) || !finite(p.y)) return null;
  }
  if (!isPenColor(color) || !isPenThickness(thickness)) return null;

  const side = PEN_THICKNESS_WORLD[thickness];
  const pad = side / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + side;
  const height = maxY - minY + side;

  const flat: number[] = [];
  for (const p of points) flat.push(p.x - x, p.y - y);

  let id: string | null = null;
  doc.transact(() => {
    const objects = objectsMap(doc);
    id = crypto.randomUUID();
    const stroke = new Y.Map<unknown>();
    stroke.set('type', 'stroke');
    stroke.set('x', x);
    stroke.set('y', y);
    stroke.set('width', width);
    stroke.set('height', height);
    stroke.set('points', flat);
    stroke.set('baseWidth', width);
    stroke.set('baseHeight', height);
    stroke.set('color', color);
    stroke.set('thickness', thickness);
    stroke.set('z', maxZ(objects) + 1);
    stroke.set('createdAt', Date.now());
    stroke.set('createdBy', by);
    objects.set(id, stroke);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's stored points as current world points.
 *
 * Points were recorded against the box the stroke was created in; a story 7
 * resize scales that box (proportionally — the registry locks the aspect), and
 * scaling each point by `width / baseWidth` is what makes the drawing grow "in
 * proportion". The thickness is deliberately *not* scaled: a resized sketch
 * keeps the pen it was drawn with (`pen.resize`).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const width = finite(s.width) ? s.width : s.baseWidth;
  const height = finite(s.height) ? s.height : s.baseHeight;
  const sx = s.baseWidth > 0 ? width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? height / s.baseHeight : 1;
  const out: Point[] = [];
  const flat = s.points;
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ x: s.x + flat[i] * sx, y: s.y + flat[i + 1] * sy });
  }
  return out;
}
