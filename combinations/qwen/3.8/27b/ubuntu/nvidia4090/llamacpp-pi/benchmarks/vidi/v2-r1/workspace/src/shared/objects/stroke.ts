// Stroke objects (story 11, stroke.model contract): document schema and
// model operations for freehand pen strokes.
//
//   objects.<id> : {
//     type:        'stroke'
//     x, y, z:     number   // bbox (padded by thickness/2), top-left world
//     width:       number   // bbox side at creation + STROKE padding
//     height:      number
//     points:      number[] // flattened [x0, y0, x1, y1, ...] relative to
//                           // the bbox origin, at the creation size
//     baseWidth:   number   // bbox size at creation; render scale is
//     baseHeight:  number   // width/baseWidth, height/baseHeight
//     color:       PenColor
//     thickness:   PenThickness
//     createdAt:   number
//     createdBy:   string
//   }
//
// Strokes are immutable after creation: the points array is replaced
// atomically only at creation; move/resize change only x/y/width/height.

import * as Y from 'yjs';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../config';
import {
  LOCAL_ORIGIN,
  nextZAboveAll,
  newObjectId,
  objects,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

/** The pen's six colours (keys of PEN_COLORS). */
export type PenColor = keyof typeof PEN_COLORS;
/** The pen's three thicknesses (keys of PEN_THICKNESS_WORLD). */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** Snapshot of a stroke object (ObjectSnapshot plus the stroke fields). */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin. */
  points: readonly number[];
  /** Bbox size at creation (render scale = width/baseWidth etc.). */
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

const STROKE_TYPE = 'stroke';

function isPenColor(v: unknown): v is PenColor {
  return typeof v === 'string' && v in PEN_COLORS;
}

function isPenThickness(v: unknown): v is PenThickness {
  return typeof v === 'string' && v in PEN_THICKNESS_WORLD;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Create a stroke from world-space `points` (non-empty, finite) in `color`
 * and `thickness`. Returns the new id, or null (no transaction) for empty
 * or non-finite points or an unknown colour/thickness name.
 *
 * The bbox is the points' extent padded by thickness/2 on every side (a
 * single point is a dot: the bbox is the thickness square centred on the
 * point, stored as a single point). Points are stored flattened, relative
 * to the bbox origin, at the creation size plus baseWidth/baseHeight.
 * One LOCAL_ORIGIN transaction; z = maxZ + 1, createdBy = `by`.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  if (a.points.length === 0) return null;
  for (const p of a.points) if (!isFinitePoint(p)) return null;
  if (!isPenColor(a.color)) return null;
  if (!isPenThickness(a.thickness)) return null;

  const t = PEN_THICKNESS_WORLD[a.thickness];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX - t / 2;
  const y = minY - t / 2;
  const width = maxX - minX + t;
  const height = maxY - minY + t;
  const flat: number[] = [];
  for (const p of a.points) {
    flat.push(p.x - x, p.y - y);
  }

  const id = newObjectId();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', STROKE_TYPE);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', flat);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', nextZAboveAll(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The stroke's points in world coordinates at its CURRENT width/height
 * (scaled from the creation size: rel * width/baseWidth, rel *
 * height/baseHeight, offset by the bbox origin). Thickness is not scaled
 * (pen.resize keeps the line width unchanged).
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  if (s.width === undefined || s.height === undefined) return [];
  if (s.baseWidth <= 0 || s.baseHeight <= 0) return [];
  const sx = s.width / s.baseWidth;
  const sy = s.height / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({
      x: s.x + (s.points[i]! as number) * sx,
      y: s.y + (s.points[i + 1]! as number) * sy,
    });
  }
  return out;
}
