import * as Y from 'yjs';
import { LOCAL_ORIGIN, OBJECTS_MAP, type ObjectSnapshot, type WorldPoint } from '../board-model';
import type { Rect } from '../geometry';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config';

/**
 * The shape object (story 10): a rectangle, ellipse or diamond with a centred
 * label and a fill/outline colour pair. It lives in the same `objects` map as
 * sticky notes and free text, so story 7's select/move/resize/delete and story 8's
 * undo apply to it unchanged (PRD "Constraints").
 *
 * Stored schema (`objects/<id>`):
 *   type: 'shape', kind, fill, stroke, x, y, width, height, z, createdAt, createdBy,
 *   label: Y.Text
 *
 * `kind` is written once and never changed (PRD: no changing a shape's kind after
 * creation), which is why there is no `setShapeKind` anywhere.
 */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  /** A shape always carries its box: it is what the renderer draws. */
  width: number;
  height: number;
  /** The tab that created it. */
  createdBy: string;
}

type AnyMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<AnyMap> {
  return doc.getMap<AnyMap>(OBJECTS_MAP);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isFiniteRect(value: Rect | null): boolean {
  return (
    value !== null &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height)
  );
}

function isFinitePoint(value: WorldPoint | null | undefined): boolean {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/** The Y.Map of a shape, or undefined for a stale id or another type. */
function shapeMap(doc: Y.Doc, id: string): AnyMap | undefined {
  const m = objectsOf(doc).get(id);
  if (!(m instanceof Y.Map)) return undefined;
  if (m.get('type') !== 'shape') return undefined;
  return m;
}

/** Highest `z` of *any* object, so a new shape lands above stickies and texts too. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsOf(doc).values()) {
    if (m instanceof Y.Map) max = Math.max(max, asFiniteNumber(m.get('z')));
  }
  return max;
}

/** The stored kind, or `rect` when the stored value is not one of the three. */
function readKind(value: unknown): ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value)
    ? (value as ShapeKind)
    : 'rect';
}

/** The stored colour, or the default when the stored name is not in its palette. */
function readFill(value: unknown): FillColor {
  return typeof value === 'string' && value in SHAPE_FILL_COLORS
    ? (value as FillColor)
    : DEFAULT_SHAPE_FILL;
}

function readStroke(value: unknown): StrokeColor {
  return typeof value === 'string' && value in SHAPE_STROKE_COLORS
    ? (value as StrokeColor)
    : DEFAULT_SHAPE_STROKE;
}

function readShape(id: string, m: AnyMap): ShapeSnap {
  const raw = m.get('label');
  const createdBy = m.get('createdBy');
  return {
    id,
    type: 'shape',
    kind: readKind(m.get('kind')),
    fill: readFill(m.get('fill')),
    stroke: readStroke(m.get('stroke')),
    label: raw instanceof Y.Text ? raw.toString() : typeof raw === 'string' ? raw : '',
    x: asFiniteNumber(m.get('x')),
    y: asFiniteNumber(m.get('y')),
    width: Math.max(asFiniteNumber(m.get('width')), 1),
    height: Math.max(asFiniteNumber(m.get('height')), 1),
    z: asFiniteNumber(m.get('z')),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}

/**
 * Every shape on the board in paint order (ascending `(z, id)`), so equal `z`
 * values from concurrent creates render identically on every client.
 */
export function shapeSnapshots(doc: Y.Doc): readonly ShapeSnap[] {
  const out: ShapeSnap[] = [];
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'shape') continue;
    out.push(readShape(id, m));
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Create a shape (PRD shape.create_drag, shape.create_click, shape.constrain).
 *
 * - `rect` is the dragged area in world units; it is kept exactly as drawn when
 *   both of its sides are at least `SHAPE_MIN_SIZE_WORLD` (a drag of exactly
 *   20 × 20 is kept).
 * - a `rect` that is `null` (a click) or narrower than that in either direction is
 *   a click: a standard `SHAPE_DEFAULT_SIZE_WORLD` square lands *centred* on `at`.
 * - `square` (Shift held during the drag) makes both sides the larger of the two
 *   dragged dimensions, anchored at the drag origin.
 *
 * Returns the new id, or `null` — writing nothing — for an unknown kind, a
 * non-finite rect or a non-finite point (design "Errors").
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: WorldPoint; square?: boolean },
  by: string,
): string | null {
  const { kind, rect, at, square } = a;
  if (!(SHAPE_KINDS as readonly string[]).includes(kind)) return null;
  if (!isFinitePoint(at)) return null;
  if (rect !== null && !isFiniteRect(rect)) return null;

  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (
    rect === null ||
    rect.width < SHAPE_MIN_SIZE_WORLD ||
    rect.height < SHAPE_MIN_SIZE_WORLD
  ) {
    // A click: the standard size, centred on the point that was clicked.
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    x = at.x - half;
    y = at.y - half;
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
  } else if (square) {
    // Shift: the larger dimension on both sides, so the shape stays square.
    const side = Math.max(rect.width, rect.height);
    x = rect.x;
    y = rect.y;
    width = side;
    height = side;
  } else {
    x = rect.x;
    y = rect.y;
    width = rect.width;
    height = rect.height;
  }

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'shape');
    m.set('kind', kind);
    m.set('fill', DEFAULT_SHAPE_FILL);
    m.set('stroke', DEFAULT_SHAPE_STROKE);
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('z', z);
    m.set('createdAt', createdAt);
    m.set('createdBy', typeof by === 'string' ? by : '');
    m.set('label', new Y.Text(''));
    objectsOf(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Pick a fill or an outline from the palettes (PRD shape.style). Only the colour
 * keys that were asked for are touched, so the label, size, position and selection
 * of the shape are unchanged. False — and no transaction — for a stale id, an
 * unknown colour name, or a colour the shape already has.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const m = shapeMap(doc, id);
  if (!m) return false;
  const next: { key: 'fill' | 'stroke'; value: string }[] = [];
  if (s.fill !== undefined) {
    if (!(s.fill in SHAPE_FILL_COLORS)) return false;
    if (m.get('fill') !== s.fill) next.push({ key: 'fill', value: s.fill });
  }
  if (s.stroke !== undefined) {
    if (!(s.stroke in SHAPE_STROKE_COLORS)) return false;
    if (m.get('stroke') !== s.stroke) next.push({ key: 'stroke', value: s.stroke });
  }
  if (next.length === 0) return false; // unknown nothing to change: no update at all
  doc.transact(() => {
    for (const change of next) m.set(change.key, change.value);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shared `Y.Text` of a shape's label, for minimal-diff editing (story 3). */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = shapeMap(doc, id);
  if (!m) return undefined;
  const label = m.get('label');
  return label instanceof Y.Text ? label : undefined;
}

// The colour palettes are also part of this module's surface: the toolbar and the
// renderer both go through the model's names rather than re-reading config.
export { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS };
export type { FillColor, ShapeKind, StrokeColor };
