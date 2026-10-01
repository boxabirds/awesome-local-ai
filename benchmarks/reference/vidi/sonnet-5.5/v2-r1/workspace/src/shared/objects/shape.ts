import * as Y from 'yjs';
import { LOCAL_ORIGIN, maxZ, objectsOf } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../config';
import type { FillColor, ShapeKind, StrokeColor } from '../config';
import type { Point, Rect } from '../geometry';

export type { ShapeKind } from '../config';

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

const HALF = 2;

export function isShapeKind(kind: string): kind is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(kind);
}
export function isFillColor(c: string): c is FillColor {
  return Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, c);
}
export function isStrokeColor(c: string): c is StrokeColor {
  return Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, c);
}

function shapeObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj && obj.get('type') === 'shape' ? obj : undefined;
}

/**
 * Creates a shape covering `rect` (world space). A null rect, or one under the minimum size in either direction,
 * means a click: a standard-size shape centred on `at`. Null (and no transaction) for an unknown kind or non-finite input.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  const { rect, at } = a;
  if (rect !== null && ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  let box: Rect;
  if (rect === null || rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    box = {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / HALF,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else {
    const side = Math.max(rect.width, rect.height);
    box = a.square ? { x: rect.x, y: rect.y, width: side, height: side } : { ...rect };
    box.width = Math.min(box.width, MAX_OBJECT_SIZE_WORLD);
    box.height = Math.min(box.height, MAX_OBJECT_SIZE_WORLD);
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', box.x);
    obj.set('y', box.y);
    obj.set('width', box.width);
    obj.set('height', box.height);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
  }, LOCAL_ORIGIN);
  return id;
}

/** Changes only the colour keys given. Unknown colour, unknown shape or no change: false and no transaction. */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const obj = shapeObj(doc, id);
  if (!obj) return false;
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

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeObj(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
