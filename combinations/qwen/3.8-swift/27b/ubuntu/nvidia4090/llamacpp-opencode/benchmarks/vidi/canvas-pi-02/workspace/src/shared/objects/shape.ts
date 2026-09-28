// The shape object model (story 10, shape.model): Yjs schema helpers for the
// rectangle / ellipse / diamond objects the Shape tool draws on the board.
//
// Schema (objects/<id>):
//   type: 'shape'
//   x, y: number            // top-left, world units
//   width, height: number   // world units
//   z: number               // stacking; higher is on top
//   createdAt: number       // epoch ms
//   createdBy: string       // client identity of the creator
//   kind: ShapeKind         // 'rect' | 'ellipse' | 'diamond'
//   fill: FillColor         // key of SHAPE_FILL_COLORS ('none' = transparent)
//   stroke: StrokeColor     // key of SHAPE_STROKE_COLORS
//   label: Y.Text
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
// rejections (unknown kind, unknown colour, non-finite numbers, stale id)
// return null/false before opening a transaction. Never throws for
// user-driven input.

import * as Y from 'yjs';
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
import { LOCAL_ORIGIN, maxZ, objectsMap, registerBoardType, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

const SHAPE_TYPE = 'shape';

// Register the type with the board schema lazily: the board-model ↔
// object-module import cycle means a module-load-time registration would run
// before KNOWN_TYPES is initialised (TDZ). Every public entry point ensures
// registration first, which is equally good for snapshots/select-all.
function ensureType(): void {
  registerBoardType(SHAPE_TYPE);
}

/** Public registration seam: the CLIENT bundle calls this at module load
 *  (via the object registry) so every client knows the type BEFORE the
 *  first remote shape arrives — objectsSnapshot filters unknown types,
 *  and a client that never created a shape locally would otherwise render
 *  remote shapes as invisible. */
export function ensureShapeType(): void {
  ensureType();
}

export type { ShapeKind };

/** Snapshot of one shape object (generic ObjectSnapshot + shape fields). */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

function newId(): string {
  return crypto.randomUUID();
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function finiteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

function shapeEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsMap(doc).get(id);
  return entry instanceof Y.Map && entry.get('type') === SHAPE_TYPE ? entry : undefined;
}

/**
 * Creates a shape and returns its new id.
 *
 * - `rect` is the dragged area in world units (normalised, positive
 *   dimensions); a null rect, or a rect below SHAPE_MIN_SIZE_WORLD in either
 *   dimension, becomes the standard SHAPE_DEFAULT_SIZE_WORLD square centred
 *   on `at` (a click / tiny drag — shape.create_click).
 * - `square` (Shift) makes width and height equal to the LARGER dragged
 *   dimension, anchored at the drag origin (rect top-left — shape.constrain).
 *
 * An unknown kind, or non-finite rect/`at` coordinates, is rejected with
 * null and no transaction. Exactly one LOCAL_ORIGIN transaction on success.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  ensureType();
  if (!SHAPE_KINDS.includes(a.kind)) return null;
  if (!finitePoint(a.at)) return null;
  if (a.rect !== null && !finiteRect(a.rect)) return null;

  let x: number;
  let y: number;
  let w: number;
  let h: number;
  if (a.rect !== null && a.rect.width >= SHAPE_MIN_SIZE_WORLD && a.rect.height >= SHAPE_MIN_SIZE_WORLD) {
    x = a.rect.x;
    y = a.rect.y;
    w = a.rect.width;
    h = a.rect.height;
    if (a.square) {
      const s = Math.max(w, h);
      w = s;
      h = s;
    }
  } else {
    // A click (or a tiny drag): the standard square centred on the point.
    x = a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2;
    y = a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2;
    w = SHAPE_DEFAULT_SIZE_WORLD;
    h = SHAPE_DEFAULT_SIZE_WORLD;
  }

  const label = new Y.Text();
  const entry = new Y.Map<unknown>();
  entry.set('type', SHAPE_TYPE);
  entry.set('x', x);
  entry.set('y', y);
  entry.set('width', w);
  entry.set('height', h);
  entry.set('z', maxZ(doc) + 1);
  entry.set('createdAt', Date.now());
  entry.set('createdBy', by);
  entry.set('kind', a.kind);
  entry.set('fill', DEFAULT_SHAPE_FILL);
  entry.set('stroke', DEFAULT_SHAPE_STROKE);
  entry.set('label', label);
  const id = newId();
  doc.transact(() => {
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Applies a fill and/or outline colour to a shape. Returns true when a
 * change was applied; false for a stale id, an unknown colour key, or an
 * exact no-op (shape.style). Only colour keys are touched: the label, size
 * and position are untouched.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  ensureType();
  const entry = shapeEntry(doc, id);
  if (entry === undefined) return false;

  let fill: FillColor | undefined;
  let stroke: StrokeColor | undefined;
  let changed = false;
  if (s.fill !== undefined) {
    if (!(s.fill in SHAPE_FILL_COLORS)) return false;
    fill = s.fill as FillColor;
    if (entry.get('fill') !== fill) changed = true;
  }
  if (s.stroke !== undefined) {
    if (!(s.stroke in SHAPE_STROKE_COLORS)) return false;
    stroke = s.stroke as StrokeColor;
    if (entry.get('stroke') !== stroke) changed = true;
  }
  if (!changed) return false;

  doc.transact(() => {
    if (fill !== undefined) entry.set('fill', fill);
    if (stroke !== undefined) entry.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's label Y.Text, if `id` exists and is a shape. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  ensureType();
  const entry = shapeEntry(doc, id);
  if (entry === undefined) return undefined;
  const label = entry.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** The shape object's extended snapshot, or null for a stale/non-shape id. */
export function shapeSnapshot(doc: Y.Doc, id: string): ShapeSnap | null {
  ensureType();
  const entry = shapeEntry(doc, id);
  if (entry === undefined) return null;
  const kind = entry.get('kind');
  const fill = entry.get('fill');
  const stroke = entry.get('stroke');
  if (typeof kind !== 'string' || !SHAPE_KINDS.includes(kind as ShapeKind)) return null;
  if (typeof fill !== 'string' || !(fill in SHAPE_FILL_COLORS)) return null;
  if (typeof stroke !== 'string' || !(stroke in SHAPE_STROKE_COLORS)) return null;
  const label = entry.get('label');
  return {
    id,
    type: 'shape',
    x: num(entry.get('x')),
    y: num(entry.get('y')),
    width: num(entry.get('width')),
    height: num(entry.get('height')),
    z: num(entry.get('z')),
    createdAt: num(entry.get('createdAt')),
    color: undefined,
    text: '',
    kind: kind as ShapeKind,
    fill: fill as FillColor,
    stroke: stroke as StrokeColor,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}
