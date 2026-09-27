// Stroke (freehand pen) object model (see spec: stroke.model).
//
// A stroke is a board object of type 'stroke':
//   objects/<id>: Y.Map {
//     type: 'stroke', x, y, width, height, z, createdAt, createdBy,
//     points: number[], baseWidth, baseHeight, color, thickness
//   }
//
// x/y/width/height are the bounding box of the points, padded by
// thickness/2 (a one-point stroke is a thickness×thickness dot). `points`
// is the flattened [x0, y0, x1, y1, ...] list RELATIVE to the bbox origin,
// at the creation size (baseWidth/baseHeight). Strokes are immutable after
// creation: move/resize only change x/y/width/height and `scaledPoints`
// re-derives the geometry (pen.resize); the thickness is never scaled.
//
// Selection, move, resize, delete and undo are the generic story 7/8 object
// operations — nothing stroke-specific is added there.

import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import type { Point } from '../geometry';
import {
  LOCAL_ORIGIN,
  registerObjectTypeName,
  type ObjectSnapshot,
} from '../board-model';

/** The six pen colour names. */
export type PenColor = keyof typeof PEN_COLORS;
/** The three pen thickness names. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** A stroke object (ObjectSnapshot with the stroke fields present). */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Flattened [x0, y0, ...] relative to (x, y), at the base size. */
  points: readonly number[];
  /** Bounding-box size at creation (render scale = width/baseWidth, …). */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

// The model owns its type name so documents with strokes can be snapshotted
// even before the client registry loads (unit tests, worker).
registerObjectTypeName('stroke');

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

/** True when v is one of the six pen colour names. */
export function isPenColor(v: unknown): v is PenColor {
  return typeof v === 'string' && v in PEN_COLORS;
}

/** True when v is one of the three pen thickness names. */
export function isPenThickness(v: unknown): v is PenThickness {
  return typeof v === 'string' && v in PEN_THICKNESS_WORLD;
}

/**
 * Create a stroke from world-space points. Returns the new id; null (no
 * transaction) for empty points, any non-finite coordinate, or an unknown
 * colour/thickness name. One LOCAL_ORIGIN transaction on success.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  const t = PEN_THICKNESS_WORLD[a.thickness];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - t / 2;
  const y = minY - t / 2;
  const width = maxX - minX + t;
  const height = maxY - minY + t;
  const relative: number[] = [];
  for (const p of a.points) {
    relative.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const object = new Y.Map();
    object.set('type', 'stroke');
    object.set('x', x);
    object.set('y', y);
    object.set('width', width);
    object.set('height', height);
    object.set('points', relative);
    object.set('baseWidth', width);
    object.set('baseHeight', height);
    object.set('color', a.color);
    object.set('thickness', a.thickness);
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's points in world coordinates at its CURRENT size: the stored
 * relative points scaled by width/baseWidth and height/baseHeight, offset
 * by the bbox origin. The thickness is not scaled (pen.resize).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i]! * sx, y: s.y + s.points[i + 1]! * sy });
  }
  return out;
}
