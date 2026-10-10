// Story 10: the `shape` object type's model layer. Field access and every
// mutation of a shape object, mirroring the sticky/text helpers. The label is
// a Y.Text (story 2's editor drives it with SHAPE_LABEL_MAX_CHARS).

import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../config';
import { LOCAL_ORIGIN, isFillColor, isShapeKind, isStrokeColor } from '../board-model';

export type { ShapeSnap } from '../board-model';

function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj;
}

function finite(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Creates a shape. `rect` is the world rectangle dragged out (null for a
// click). A null rect, or a rect below SHAPE_MIN_SIZE_WORLD in either
// dimension, drops a default-size shape centred on `at` instead. With
// `square`, both sides take the larger dragged dimension, anchored at the
// rect origin. Unknown kind or non-finite input writes nothing (null).
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: { x: number; y: number; width: number; height: number } | null; at: { x: number; y: number }; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!finite(a.at?.x) || !finite(a.at?.y)) return null;

  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (a.rect === null) {
    width = height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    const { rect } = a;
    if (!finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) {
      return null;
    }
    x = rect.x;
    y = rect.y;
    width = rect.width;
    height = rect.height;
    if (a.square) {
      const side = Math.max(width, height);
      width = side;
      height = side;
    }
    if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) {
      width = height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    }
  }

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const z = maxZ(objects) + 1;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text(''));
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// Applies fill and/or stroke. Any provided colour that is not in its palette
// (or a stale/non-shape id) rejects the whole call without a transaction. Only
// the colour keys are touched, so label, size, position and selection survive.
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const obj = shapeMap(doc, id);
  if (!obj) return false;
  const writes: [string, string][] = [];
  if (s.fill !== undefined) {
    if (!isFillColor(s.fill)) return false;
    writes.push(['fill', s.fill]);
  }
  if (s.stroke !== undefined) {
    if (!isStrokeColor(s.stroke)) return false;
    writes.push(['stroke', s.stroke]);
  }
  if (writes.length === 0) return true;
  doc.transact(() => {
    for (const [key, value] of writes) obj.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = shapeMap(doc, id);
  if (!obj) return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}
