// Shapes (story 10): rectangles, ellipses and diamonds with a fill, an outline and a centred label.
//
// objects/<id>: Y.Map { type: 'shape', x, y, width, height, z, createdAt, createdBy, kind: ShapeKind,
//                       fill: FillColor, stroke: StrokeColor, label: Y.Text }
//
// Selection, moving, resizing, deleting and undo are the generic story 7/8 operations. As in board-model, every
// successful mutation is one LOCAL_ORIGIN transaction; rejected or no-op calls return null/false without one.
import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, registerSnapshotReader, type ObjectSnapshot } from '../board-model';
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

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type { FillColor, StrokeColor };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export function isShapeKind(k: unknown): k is ShapeKind {
  return typeof k === 'string' && (SHAPE_KINDS as readonly string[]).includes(k);
}

export function isFillColor(c: unknown): c is FillColor {
  return typeof c === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, c);
}

export function isStrokeColor(c: unknown): c is StrokeColor {
  return typeof c === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, c);
}

export function isShape(obj: ObjectSnapshot): obj is ShapeSnap {
  return obj.type === 'shape';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function getShapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'shape' ? obj : undefined;
}

registerSnapshotReader('shape', (_id, obj, base) => {
  const kind = obj.get('kind');
  if (!isShapeKind(kind)) return null;
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const label = obj.get('label');
  return {
    ...base,
    type: 'shape',
    kind,
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  } satisfies ShapeSnap;
});

/**
 * The rect a new shape gets. `square` makes both sides the larger dimension, anchored at the rect's top-left
 * (the tool passes the rect with its drag origin already on the right corner). A missing rect (a click) or one
 * smaller than SHAPE_MIN_SIZE_WORLD in either direction gives a SHAPE_DEFAULT_SIZE_WORLD shape centred on `at`.
 */
export function shapeRect(rect: Rect | null, at: Point, square = false): Rect {
  let r = rect;
  if (r && square) {
    const side = Math.max(r.width, r.height);
    r = { x: r.x, y: r.y, width: side, height: side };
  }
  if (!r || r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    return { x: at.x - s / 2, y: at.y - s / 2, width: s, height: s };
  }
  return {
    x: r.x,
    y: r.y,
    width: Math.min(MAX_OBJECT_SIZE_WORLD, r.width),
    height: Math.min(MAX_OBJECT_SIZE_WORLD, r.height),
  };
}

/**
 * Adds a shape of `kind` above all other objects, with the default fill and outline and an empty label.
 * Returns the new id, or null (and changes nothing) for an unknown kind or non-finite numbers.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!isFiniteNumber(a.at?.x) || !isFiniteNumber(a.at?.y)) return null;
  if (a.rect && ![a.rect.x, a.rect.y, a.rect.width, a.rect.height].every(isFiniteNumber)) return null;
  if (a.rect && (a.rect.width < 0 || a.rect.height < 0)) return null;
  const r = shapeRect(a.rect, a.at, a.square === true);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objectsOf(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Sets the fill and/or outline colour, touching nothing else. False (no write) for a stale id, an unknown colour
 * name or no change.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const obj = getShapeMap(doc, id);
  if (!obj) return false;
  const fill = s.fill !== undefined && obj.get('fill') !== s.fill ? s.fill : undefined;
  const stroke = s.stroke !== undefined && obj.get('stroke') !== s.stroke ? s.stroke : undefined;
  if (fill === undefined && stroke === undefined) return false;
  doc.transact(() => {
    if (fill !== undefined) obj.set('fill', fill);
    if (stroke !== undefined) obj.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The label's Y.Text (edited with the shared text editor, SHAPE_LABEL_MAX_CHARS), or undefined. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = getShapeMap(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
