import * as Y from 'yjs';
import { LOCAL_ORIGIN, OBJECTS_MAP, type ObjectSnapshot, type WorldPoint } from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';

/**
 * A freehand stroke (story 11): the bbox the drawing occupies plus the drawn points
 * relative to that box's origin, at the size the stroke was created at.
 *
 * Stored schema (`objects/<id>`):
 *   type: 'stroke', x, y, width, height, z, createdAt, createdBy,
 *   points: number[]       // flattened [x0, y0, x1, y1, …] relative to the bbox origin
 *   baseWidth, baseHeight  // bbox size at creation; render scale = width/baseWidth
 *   color, thickness
 *
 * The box is padded by half the ink, so the drawn line — a stroke of
 * `PEN_THICKNESS_WORLD` width — fits inside it exactly, and the handles that story 7
 * puts around the box line up with what a person sees.
 *
 * Points are a plain array replaced atomically, never edited point by point: a
 * stroke is immutable once drawn (PRD out of scope: no editing individual points, no
 * recolouring), and only the generic x/y/width/height change on move and resize, so
 * story 7's and story 8's shared behaviour applies to it unchanged.
 */
export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  /** A stroke always carries its box: it is what the renderer draws into. */
  width: number;
  height: number;
  /** The tab that drew it. */
  createdBy: string;
}

/** Is this snapshot a stroke? The registry's hit test asks without importing the type. */
export function isStrokeSnap(obj: ObjectSnapshot): obj is StrokeSnap {
  return obj.type === 'stroke';
}

type AnyMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<AnyMap> {
  return doc.getMap<AnyMap>(OBJECTS_MAP);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The stored ink, or the pen's own default when the stored name is not one of six. */
function readColor(value: unknown): PenColor {
  return typeof value === 'string' && value in PEN_COLORS
    ? (value as PenColor)
    : DEFAULT_PEN_COLOR;
}

function readThickness(value: unknown): PenThickness {
  return typeof value === 'string' && value in PEN_THICKNESS_WORLD
    ? (value as PenThickness)
    : DEFAULT_PEN_THICKNESS;
}

/** The stored numbers, ignoring anything that is not a finite number. */
function readPoints(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
    else out.push(0); // a broken point stays a point, at the box's origin
  }
  // A half-written pair is not a point at all.
  if (out.length % 2 !== 0) out.pop();
  return out;
}

function readStroke(id: string, m: AnyMap): StrokeSnap {
  const width = Math.max(asFiniteNumber(m.get('width')), 0);
  const height = Math.max(asFiniteNumber(m.get('height')), 0);
  // A stroke written before a resize always carries the size it was drawn at; if it
  // is missing, the box *is* that size, so the scale comes out as 1.
  const baseWidth = asFiniteNumber(m.get('baseWidth'), width) || width || 1;
  const baseHeight = asFiniteNumber(m.get('baseHeight'), height) || height || 1;
  const createdBy = m.get('createdBy');
  return {
    id,
    type: 'stroke',
    x: asFiniteNumber(m.get('x')),
    y: asFiniteNumber(m.get('y')),
    width,
    height,
    z: asFiniteNumber(m.get('z')),
    points: readPoints(m.get('points')),
    baseWidth,
    baseHeight,
    color: readColor(m.get('color')),
    thickness: readThickness(m.get('thickness')),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

/**
 * Every stroke on the board in paint order (ascending `(z, id)`), so equal `z` values
 * from concurrent draws render identically on every client.
 */
export function strokeSnapshots(doc: Y.Doc): readonly StrokeSnap[] {
  const out: StrokeSnap[] = [];
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'stroke') continue;
    out.push(readStroke(id, m));
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Highest `z` of *any* object, so a new stroke lands above notes, text and shapes. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsOf(doc).values()) {
    if (m instanceof Y.Map) max = Math.max(max, asFiniteNumber(m.get('z')));
  }
  return max;
}

/** A point that can be drawn: a real object holding two finite numbers. */
function isUsablePoint(value: unknown): value is WorldPoint {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isFinite((value as WorldPoint).x) &&
    Number.isFinite((value as WorldPoint).y)
  );
}

/**
 * Draw a stroke (PRD `pen.draw`, `pen.dot`, `pen.long_stroke`).
 *
 * `points` are world-space points as they were recorded (already simplified by the
 * caller, or not). The box is their bounds padded by half the ink — for a single
 * point, exactly the ink's square, which is what makes a click a round dot. The
 * points are stored relative to that box and tagged with the size they were drawn at,
 * so a later proportional resize scales the drawing without touching the ink.
 *
 * Returns the new id, or `null` — writing nothing, and sending nothing to anybody —
 * when there are no points, a coordinate is not a number, or the colour or thickness
 * is not one of the product's own (design "Errors").
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly WorldPoint[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  const points = a.points;
  if (!Array.isArray(points) || points.length === 0) return null;
  for (const p of points) if (!isUsablePoint(p)) return null;
  if (!(a.color in PEN_COLORS)) return null;
  if (!(a.thickness in PEN_THICKNESS_WORLD)) return null;

  const ink = PEN_THICKNESS_WORLD[a.thickness];
  const pad = ink / 2;
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
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + ink;
  const height = maxY - minY + ink;
  if (!(width > 0) || !(height > 0)) return null;

  const stored: number[] = [];
  for (const p of points) {
    stored.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'stroke');
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('z', z);
    m.set('createdAt', createdAt);
    m.set('createdBy', typeof by === 'string' ? by : '');
    m.set('points', stored);
    m.set('baseWidth', width);
    m.set('baseHeight', height);
    m.set('color', a.color);
    m.set('thickness', a.thickness);
    objectsOf(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * The drawn points as they sit on the board *now*: the stored points scaled from the
 * size the stroke was created at to its current box, then moved into board space.
 *
 * This backs both the renderer and the hit test (PRD `pen.resize`, `pen.select`), so
 * a stroke that has been resized in proportion is selected where it is *drawn*, not
 * where its box happens to be.
 */
export function scaledPoints(s: StrokeSnap): WorldPoint[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: WorldPoint[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}

/** The ink this stroke is drawn with, in board units. */
export function strokeInkWorld(s: StrokeSnap): number {
  return PEN_THICKNESS_WORLD[s.thickness];
}

/** The colour this stroke is drawn in. */
export function strokeColor(s: StrokeSnap): string {
  return PEN_COLORS[s.color];
}

export type { PenColor, PenThickness };
