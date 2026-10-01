import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, MAX_OBJECT_SIZE_WORLD, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_FILL_COLORS,
  SHAPE_KINDS, SHAPE_MIN_SIZE_WORLD, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export type ShapeKind = typeof SHAPE_KINDS[number];

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape'; kind: ShapeKind; fill: FillColor; stroke: StrokeColor; label: string;
}

const HALF = 2;
const has = (o: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

export const isShapeKind = (k: unknown): k is ShapeKind => (SHAPE_KINDS as readonly unknown[]).includes(k);
export const isFillColor = (c: unknown): c is FillColor => has(SHAPE_FILL_COLORS, c);
export const isStrokeColor = (c: unknown): c is StrokeColor => has(SHAPE_STROKE_COLORS, c);

const objectsOf = (doc: Y.Doc) => doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

function shapeObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map && obj.get('type') === 'shape' ? obj : undefined;
}

/** The square a Shift-drag makes: side = larger dragged dimension, anchored at the drag origin. */
export function squareRect(origin: Point, current: Point): Rect {
  const side = Math.max(Math.abs(current.x - origin.x), Math.abs(current.y - origin.y));
  return {
    x: current.x >= origin.x ? origin.x : origin.x - side,
    y: current.y >= origin.y ? origin.y : origin.y - side,
    width: side, height: side,
  };
}

/**
 * `rect` is the dragged area (null for a click); below the minimum size in either direction the shape is the
 * standard size centred on `at`. Returns null, writing nothing, for an unknown kind or non-finite numbers.
 */
export function createShape(
  doc: Y.Doc, a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean }, by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  const r = a.rect;
  if (r && ![r.x, r.y, r.width, r.height].every(Number.isFinite)) return null;
  let box: Rect;
  if (!r || r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
    box = {
      x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / HALF, y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else {
    const side = Math.max(r.width, r.height);
    box = a.square ? { x: r.x, y: r.y, width: side, height: side } : { ...r };
    box.width = Math.min(box.width, MAX_OBJECT_SIZE_WORLD);
    box.height = Math.min(box.height, MAX_OBJECT_SIZE_WORLD);
  }
  const id = crypto.randomUUID();
  doc.transact(() => {
    let max = 0;
    objectsOf(doc).forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : 0;
      if (typeof z === 'number') max = Math.max(max, z);
    });
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'shape');
    obj.set('x', box.x); obj.set('y', box.y); obj.set('width', box.width); obj.set('height', box.height);
    obj.set('z', max + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
  }, LOCAL_ORIGIN);
  return id;
}

/** False (nothing written) for a stale id, an unknown colour name, or when nothing would change. */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const obj = shapeObject(doc, id);
  if (!obj) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const changes: Array<[string, string]> = [];
  if (s.fill !== undefined && obj.get('fill') !== s.fill) changes.push(['fill', s.fill]);
  if (s.stroke !== undefined && obj.get('stroke') !== s.stroke) changes.push(['stroke', s.stroke]);
  if (changes.length === 0) return false;
  doc.transact(() => changes.forEach(([k, v]) => obj.set(k, v)), LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = shapeObject(doc, id)?.get('label');
  return t instanceof Y.Text ? t : undefined;
}
