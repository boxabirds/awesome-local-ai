/**
 * Stroke object model (story 11, design stroke.model): the 'stroke' object
 * type is a freehand pen path, created by the Pen tool.
 *
 * This module is the single owner of the 'stroke' schema and its create
 * mutation, exactly like board-model is for stickies and shape.ts is for
 * shapes. It registers 'stroke' as a known object type on import so
 * shared-level code (unit tests) can create and snapshot strokes without
 * the client-side registry.
 *
 * Storage: the entry carries the bounding box (padded by half the
 * thickness so the line and its round caps fit inside), the pen colour and
 * thickness names, `baseWidth`/`baseHeight` (the bbox at creation) and
 * `points` — the simplified path flattened to [x0, y0, x1, y1, …] and
 * stored RELATIVE to the bbox origin. `scaledPoints` maps them back to
 * world coordinates after any proportional resize (width/baseWidth,
 * height/baseHeight); the thickness is never scaled (pen.resize).
 *
 * A click (no movement) is a stroke with a single point: its bbox is a
 * square of the thickness and the round stroke cap renders it as a dot
 * whose diameter equals the thickness (pen.dot).
 */

import * as Y from 'yjs';
import {
  addKnownObjectType,
  LOCAL_ORIGIN,
  maxZ,
  type ObjectSnapshot,
} from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';

// The stroke model owns the 'stroke' type for the document layer (idempotent;
// the client registry registers it again when it loads).
addKnownObjectType('stroke');

/** Immutable view of one pen stroke. */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  /** Flattened [x0, y0, x1, y1, …] relative to the bbox origin. */
  points: readonly number[];
  /** The bbox size at creation (the scale anchor). */
  baseWidth: number;
  /** The bbox size at creation (the scale anchor). */
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

/** Arguments for createStroke. */
export interface CreateStrokeArgs {
  /** The simplified path in world coordinates (at least one point). */
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Creates a pen stroke on top of every other object and returns its id.
 *
 * Validation (all in one pass, before any transaction): `by` must be a
 * string, `color` and `thickness` must be known names, and the points must
 * be non-empty with finite coordinates. Any violation returns null with
 * ZERO update events — no partial state ever reaches the document.
 *
 * One LOCAL_ORIGIN transaction writes the entry: bbox padded by half the
 * thickness (a single point yields a thickness-sized square), the points
 * flattened and made relative to the bbox origin, and the base size for
 * proportional rescaling.
 */
export function createStroke(
  doc: Y.Doc,
  a: CreateStrokeArgs,
  by: string,
): string | null {
  if (
    typeof by !== 'string' ||
    typeof a !== 'object' ||
    a === null ||
    !Array.isArray(a.points) ||
    a.points.length === 0 ||
    !a.points.every(
      (p) => typeof p === 'object' && p !== null && finiteNumber(p.x) && finiteNumber(p.y),
    ) ||
    typeof a.color !== 'string' ||
    !(a.color in PEN_COLORS) ||
    typeof a.thickness !== 'string' ||
    !(a.thickness in PEN_THICKNESS_WORLD)
  ) {
    return null;
  }
  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thickness / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;
  const flat: number[] = [];
  for (const p of a.points) {
    flat.push(p.x - x, p.y - y);
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'stroke');
      entry.set('x', x);
      entry.set('y', y);
      entry.set('width', width);
      entry.set('height', height);
      entry.set('baseWidth', width);
      entry.set('baseHeight', height);
      entry.set('points', flat);
      entry.set('color', a.color);
      entry.set('thickness', a.thickness);
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      entry.set('createdBy', by);
      doc.getMap('objects').set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * The stroke's path at the snapshot's current size, relative to the bbox
 * origin: each stored (relative) point scaled by width/baseWidth and
 * height/baseHeight. This is the coordinate space StrokeObject's SVG lives
 * in (the object div sits at the bbox origin with a local viewBox).
 * The thickness is NOT scaled — it is read from the stored name (pen.resize).
 */
export function scaledRelativePoints(s: StrokeSnap): Point[] {
  const sx = s.baseWidth > 0 ? (s.width ?? s.baseWidth) / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? (s.height ?? s.baseHeight) / s.baseHeight : 1;
  const out: Point[] = [];
  const pts = s.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push({ x: pts[i] * sx, y: pts[i + 1] * sy });
  }
  return out;
}

/**
 * World coordinates of the stroke's path at the snapshot's current size:
 * the bbox-relative points offset by the bbox origin.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const rel = scaledRelativePoints(s);
  return rel.map((p) => ({ x: p.x + s.x, y: p.y + s.y }));
}
