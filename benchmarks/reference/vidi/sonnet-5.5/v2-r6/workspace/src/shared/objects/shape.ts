import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ShapeKind, type ShapeSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_FILL_COLORS, SHAPE_KINDS, SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../config';
import type { Point, Rect } from '../geometry';

export type { ShapeKind };
export type ShapeSnap = ShapeSnapshot;

const HALF = 2;

function objectsOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects') as Y.Map<unknown>;
}

function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsOf(doc).get(id);
  return m instanceof Y.Map && m.get('type') === 'shape' ? m : undefined;
}

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));
const hasKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Creates a shape covering `rect` (world space). `rect: null`, or a rect smaller than SHAPE_MIN_SIZE_WORLD in
 * either direction, makes a standard-size shape centred on `at` (a click). `square` makes both sides the larger
 * one, from the rect's top-left. Null (nothing written) for an unknown kind or non-finite numbers.
 */
export function createShape(
  doc: Y.Doc, a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean }, by: string,
): string | null {
  if (!SHAPE_KINDS.includes(a.kind)) return null;
  if (!finite(a.at.x, a.at.y)) return null;
  if (a.rect && !finite(a.rect.x, a.rect.y, a.rect.width, a.rect.height)) return null;
  let box: Rect;
  if (!a.rect || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    box = {
      x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / HALF, y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else if (a.square) {
    const side = Math.max(a.rect.width, a.rect.height);
    box = { x: a.rect.x, y: a.rect.y, width: side, height: side };
  } else {
    box = { ...a.rect };
  }
  const id = crypto.randomUUID();
  let z = 0;
  objectsOf(doc).forEach((o) => {
    const v = o instanceof Y.Map ? o.get('z') : 0;
    if (typeof v === 'number' && Number.isFinite(v)) z = Math.max(z, v);
  });
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objectsOf(doc).set(id, m);
    m.set('type', 'shape');
    m.set('kind', a.kind);
    m.set('x', box.x);
    m.set('y', box.y);
    m.set('width', box.width);
    m.set('height', box.height);
    m.set('fill', DEFAULT_SHAPE_FILL);
    m.set('stroke', DEFAULT_SHAPE_STROKE);
    m.set('label', new Y.Text());
    m.set('z', z + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes only the colour keys given. False (nothing written) for a stale id, an unknown colour, or no change. */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const m = shapeMap(doc, id);
  if (!m) return false;
  if (s.fill !== undefined && !hasKey(SHAPE_FILL_COLORS, s.fill)) return false;
  if (s.stroke !== undefined && !hasKey(SHAPE_STROKE_COLORS, s.stroke)) return false;
  const fill = s.fill !== undefined && m.get('fill') !== s.fill ? s.fill : undefined;
  const stroke = s.stroke !== undefined && m.get('stroke') !== s.stroke ? s.stroke : undefined;
  if (fill === undefined && stroke === undefined) return false;
  doc.transact(() => {
    if (fill !== undefined) m.set('fill', fill);
    if (stroke !== undefined) m.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = shapeMap(doc, id)?.get('label');
  return t instanceof Y.Text ? t : undefined;
}
