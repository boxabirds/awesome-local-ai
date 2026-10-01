import * as Y from 'yjs';
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
  type ShapeKind,
  type StrokeColor,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export type { ShapeKind };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export function isShape(o: ObjectSnapshot): o is ShapeSnap {
  return o.type === 'shape';
}

export function isShapeKind(k: unknown): k is ShapeKind {
  return typeof k === 'string' && (SHAPE_KINDS as readonly string[]).includes(k);
}
export function isFillColor(c: unknown): c is FillColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, c);
}
export function isStrokeColor(c: unknown): c is StrokeColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, c);
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z)) max = Math.max(max, z);
  });
  return max;
}

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));

/**
 * A rect covering the dragged area, or - for a click (rect null) or a drag smaller than SHAPE_MIN_SIZE_WORLD in
 * either direction - a standard-size shape centred on `at`. `square` makes both sides the larger one.
 * Null (nothing written) for an unknown kind or non-finite numbers.
 */
export function createShape(doc: Y.Doc, a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean }, by: string): string | null {
  if (!isShapeKind(a.kind) || !finite(a.at.x, a.at.y)) return null;
  if (a.rect && !finite(a.rect.x, a.rect.y, a.rect.width, a.rect.height)) return null;
  let r: Rect;
  if (!a.rect || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    r = { x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2, y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
  } else {
    const side = Math.max(a.rect.width, a.rect.height);
    r = a.square ? { x: a.rect.x, y: a.rect.y, width: side, height: side } : { ...a.rect };
  }
  r.width = Math.min(r.width, MAX_OBJECT_SIZE_WORLD);
  r.height = Math.min(r.height, MAX_OBJECT_SIZE_WORLD);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objects(doc).set(id, obj);
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** Only the named colour keys change. False (nothing written) for a stale id, an unknown colour or no change. */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const changes: [string, string][] = [];
  if (s.fill !== undefined && obj.get('fill') !== s.fill) changes.push(['fill', s.fill]);
  if (s.stroke !== undefined && obj.get('stroke') !== s.stroke) changes.push(['stroke', s.stroke]);
  if (changes.length === 0) return false;
  doc.transact(() => changes.forEach(([k, v]) => obj.set(k, v)), LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  const t = obj?.get('type') === 'shape' ? obj.get('label') : undefined;
  return t instanceof Y.Text ? t : undefined;
}
