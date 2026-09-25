/**
 * Shapes: rectangles, ellipses and diamonds with a fill, an outline and a centred label
 * (anchor: shape.model).
 *
 *   objects/<id>: Y.Map { type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *                         kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text }
 *
 * Selection, move, resize, delete and undo are the generic board-model operations. Like
 * board-model, every successful mutation is one LOCAL_ORIGIN transaction; unknown kinds or
 * colours, stale ids and non-finite numbers return null/false without a transaction.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, nextZ, registerSnapshotReader, type ObjectSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../config';
import type { Point, Rect } from '../geometry';

export const SHAPE_TYPE = 'shape';
const HALF = 2;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

export function isShapeSnap(obj: ObjectSnapshot): obj is ShapeSnap {
  return obj.type === SHAPE_TYPE;
}

function finite(...values: number[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === SHAPE_TYPE ? obj : undefined;
}

registerSnapshotReader(SHAPE_TYPE, (base, obj): ShapeSnap => {
  const kind = obj.get('kind');
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const label = obj.get('label');
  return {
    ...base,
    type: SHAPE_TYPE,
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
});

/**
 * The rect a creation gesture produces (world units):
 * - `square`: both sides become the larger dragged dimension, anchored at the drag origin `at`
 *   (shape.constrain);
 * - `rect` null, or smaller than SHAPE_MIN_SIZE_WORLD in either direction: a
 *   SHAPE_DEFAULT_SIZE_WORLD square centred on `at` (shape.create_click);
 * - otherwise the dragged rect as is (shape.create_drag), capped at MAX_OBJECT_SIZE_WORLD.
 */
export function shapeRect(rect: Rect | null, at: Point, square = false): Rect {
  let r = rect === null ? null : normalise(rect);
  if (r !== null && square) {
    const side = Math.max(r.width, r.height);
    // The corner the drag started from stays put; the square grows in the drag direction.
    const x = at.x > r.x + r.width / HALF ? r.x + r.width - side : r.x;
    const y = at.y > r.y + r.height / HALF ? r.y + r.height - side : r.y;
    r = { x, y, width: side, height: side };
  }
  if (r === null || r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    return {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  return { ...r, width: Math.min(r.width, MAX_OBJECT_SIZE_WORLD), height: Math.min(r.height, MAX_OBJECT_SIZE_WORLD) };
}

function normalise(r: Rect): Rect {
  return {
    x: Math.min(r.x, r.x + r.width),
    y: Math.min(r.y, r.y + r.height),
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  };
}

/**
 * Creates a shape (default fill and outline, empty label) above every other object.
 * Returns its id, or null (nothing written) for an unknown kind or non-finite input.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind) || !finite(a.at.x, a.at.y)) return null;
  if (a.rect !== null && !finite(a.rect.x, a.rect.y, a.rect.width, a.rect.height)) return null;
  const r = shapeRect(a.rect, a.at, a.square === true);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', SHAPE_TYPE);
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', nextZ(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    doc.getMap<Y.Map<unknown>>('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Sets the fill and/or outline colour (shape.style). False, with nothing written, for a stale
 * id, an unknown colour name or when nothing would change. Only the colour keys are touched.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const obj = shapeMap(doc, id);
  if (obj === undefined) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const fill = s.fill !== undefined && obj.get('fill') !== s.fill ? s.fill : undefined;
  const stroke = s.stroke !== undefined && obj.get('stroke') !== s.stroke ? s.stroke : undefined;
  if (fill === undefined && stroke === undefined) return false;
  doc.transact(() => {
    if (fill !== undefined) obj.set('fill', fill);
    if (stroke !== undefined) obj.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The label's Y.Text (edited with the shared text editor, SHAPE_LABEL_MAX_CHARS). */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeMap(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
