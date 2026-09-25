/**
 * Story 11 · the stroke model (design "Stroke model and geometry").
 *
 * One sketch is one board object. Its recorded path is stored *inside* the
 * object's `Y.Map` as a flat `[x0, y0, x1, y1, …]` array of coordinates
 * relative to the object's own box, alongside the box size the path was recorded
 * at (`baseWidth` / `baseHeight`). That shape is deliberate:
 *
 *  - a stroke is **immutable after it is drawn** — only the generic story-7
 *    fields (`x`, `y`, `width`, `height`) ever change, so the path is replaced
 *    atomically or not at all, never edited point by point;
 *  - a proportional resize therefore needs no stroke-specific code: the handles
    change the box and {@link scaledPoints} re-derives the geometry from it, with
    the ink width untouched (PRD `pen.resize`).
 *
 * Like every other model entry point, this module never throws for user input:
 * empty or non-finite points, an unknown ink or an unknown width return `null`
 * and open no transaction, so a rejected gesture costs no sync traffic.
 */
import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_COORDS,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import {
  LOCAL_ORIGIN,
  newId,
  objectsOf,
  readSize,
  recordIsType,
  topZ,
  type ObjectRecord,
} from '../doc';

export type { PenColor, PenThickness };

/** The object type string, the registry key and the snapshot discriminator. */
export const STROKE_TYPE = 'stroke';

/**
 * A stroke as the render layer sees it: the generic object fields plus the
 * recorded path (`points`, relative to the box origin at creation size), the box
 * size that path was recorded against, and the two style tokens.
 */
export interface StrokeSnap {
  id: string;
  type: typeof STROKE_TYPE;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  createdAt: number;
  /** Flattened `[x0, y0, …]` coordinates, relative to the box origin. */
  points: readonly number[];
  /** The box width `points` were recorded against. */
  baseWidth: number;
  /** The box height `points` were recorded against. */
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  createdBy?: string;
}

/** What the pen hands over when a gesture finishes. */
export interface StrokeInput {
  /** The simplified path, in world coordinates. */
  points: readonly Point[];
  color: PenColor;
  thickness: PenThickness;
}

/** True when the token is one of the six inks. */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

/** True when the token is one of the three widths. */
export function isPenThickness(value: unknown): value is PenThickness {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value)
  );
}

/**
 * Record a sketch as one board object, on top of everything else, in a single
 * `LOCAL_ORIGIN` transaction (so one drawing is one undo step).
 *
 * The box is the path's bounding rectangle padded by half the ink width on each
 * side, and the stored coordinates are relative to that padded origin — which is
 * why a one-point dot gets a `thickness`-squared box: a dot has no extent of its
 * own, so the ink is what gives it one (PRD `pen.dot`).
 *
 * Returns the new id, or `null` when there is nothing to record (no points, a
 * non-finite coordinate, an unknown ink or width) — no transaction is opened in
 * that case.
 */
export function createStroke(
  doc: Y.Doc,
  input: StrokeInput,
  by: string,
): string | null {
  const points = input.points;
  if (!Array.isArray(points) || points.length === 0) return null;
  if (points.length > STROKE_MAX_COORDS / 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (
      point === null ||
      point === undefined ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      return null;
    }
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (!isPenColor(input.color) || !isPenThickness(input.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[input.thickness];
  const pad = thickness / 2;
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + thickness;
  const height = maxY - minY + thickness;

  // Relative to the padded box origin, flattened: the renderer and the hit test
  // both rebuild world points from it, so nothing here stores absolute places.
  const stored: number[] = new Array<number>(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    stored[i * 2] = points[i].x - x;
    stored[i * 2 + 1] = points[i].y - y;
  }

  const id = newId();
  const top = topZ(doc) + 1;
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    record.set('type', STROKE_TYPE);
    record.set('x', x);
    record.set('y', y);
    record.set('width', width);
    record.set('height', height);
    record.set('z', top);
    record.set('createdAt', Date.now());
    record.set('color', input.color);
    record.set('thickness', input.thickness);
    record.set('baseWidth', width);
    record.set('baseHeight', height);
    record.set('points', stored);
    record.set('createdBy', by);
    objectsOf(doc).set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/** The stored coordinate array, whatever shape the document handed back. */
function readPoints(value: unknown): readonly number[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length % 2 !== 0) return null;
    if (value.length > STROKE_MAX_COORDS) return null;
    for (const item of value) {
      if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    }
    return value as number[];
  }
  if (value instanceof Y.Array) {
    const items = value.toArray();
    if (items.length === 0 || items.length % 2 !== 0) return null;
    if (items.length > STROKE_MAX_COORDS) return null;
    const out: number[] = [];
    for (const item of items) {
      if (typeof item !== 'number' || !Number.isFinite(item)) return null;
      out.push(item);
    }
    return out;
  }
  return null;
}

/** True when the record is a stroke this client can read. */
export function strokeRecord(record: ObjectRecord | undefined): record is ObjectRecord {
  return recordIsType(record, STROKE_TYPE);
}

/** The generic object fields a snapshot entry needs before its path is read. */
export interface StrokeBase {
  id: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  createdAt: number;
}

/**
 * Build the snapshot entry for a stroke record, or `null` when it cannot be
 * drawn (a damaged, empty or over-long path). `snapshot()` calls this, so a
 * stroke written by someone else needs no client-side migration: it appears as
 * soon as the document does.
 */
export function strokeSnapshot(
  record: ObjectRecord,
  base: StrokeBase,
): StrokeSnap | null {
  const points = readPoints(record.get('points'));
  if (points === null) return null;
  const color = record.get('color');
  const thickness = record.get('thickness');
  const createdBy = record.get('createdBy');
  const snap: StrokeSnap = {
    ...base,
    type: STROKE_TYPE,
    points,
    baseWidth: readSize(record.get('baseWidth')),
    baseHeight: readSize(record.get('baseHeight')),
    color: isPenColor(color) ? color : DEFAULT_PEN_COLOR,
    thickness: isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS,
  };
  if (typeof createdBy === 'string') snap.createdBy = createdBy;
  return snap;
}

/**
 * The stroke's path in world coordinates: every stored coordinate scaled by the
 * current box over the box it was recorded against.
 *
 * Both axes use their own factor, but story 7 resizes a stroke through
 * `aspectLocked` handles, so in practice the two stay equal and the drawing
 * grows without smearing. The ink width is *not* scaled — a resize moves and
 * stretches the sketch, it does not swap the pen (PRD `pen.resize`).
 */
export function scaledPoints(snap: {
  x: number;
  y: number;
  width: number;
  height: number;
  points?: readonly number[];
  baseWidth?: number;
  baseHeight?: number;
}): Point[] {
  const points = snap.points;
  if (!Array.isArray(points) || points.length < 2) return [];
  const baseWidth = snap.baseWidth ?? 0;
  const baseHeight = snap.baseHeight ?? 0;
  const sx = baseWidth > 0 && Number.isFinite(snap.width) ? snap.width / baseWidth : 1;
  const sy = baseHeight > 0 && Number.isFinite(snap.height) ? snap.height / baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i];
    const py = points[i + 1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    out.push({ x: snap.x + px * sx, y: snap.y + py * sy });
  }
  return out;
}

/** The ink width of a snapshot, defaulting for a document that named none. */
export function strokeThicknessWorld(thickness: string | undefined): number {
  return PEN_THICKNESS_WORLD[isPenThickness(thickness) ? thickness : DEFAULT_PEN_THICKNESS];
}

/**
 * Repaint an existing sketch (design "PenToolbar", PRD `pen.options`): change its
 * ink token, its width token, or both, in one `LOCAL_ORIGIN` transaction.
 *
 * A sketch is recoloured *as the object it already is* — the recorded path is
 * untouched and no second object appears — so the two tokens are the only things
 * this can write. An unknown token, an unknown id, or a change that would write
 * what is already stored all return `false` and open no transaction.
 */
export function setStrokeStyle(
  doc: Y.Doc,
  id: string,
  style: { color?: string; thickness?: string },
): boolean {
  const record = objectsOf(doc).get(id);
  if (!strokeRecord(record)) return false;

  const writes: Array<[string, string]> = [];
  if (style.color !== undefined) {
    if (!isPenColor(style.color)) return false;
    if (record.get('color') !== style.color) writes.push(['color', style.color]);
  }
  if (style.thickness !== undefined) {
    if (!isPenThickness(style.thickness)) return false;
    if (record.get('thickness') !== style.thickness) {
      writes.push(['thickness', style.thickness]);
    }
  }
  if (writes.length === 0) return false;

  doc.transact(() => {
    for (const [key, value] of writes) record.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}
