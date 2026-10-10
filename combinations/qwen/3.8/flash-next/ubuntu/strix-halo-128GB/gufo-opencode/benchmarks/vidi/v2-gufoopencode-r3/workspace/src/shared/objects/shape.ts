import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
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
  type StrokeColor
} from '../config';
import type { Point, Rect } from '../geometry';

export interface ShapeSnap extends ObjectSnapshot {
  readonly type: 'shape';
  readonly kind: ShapeKind;
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  readonly label: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'shape') return undefined;
  return obj;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

// A drag below the minimum size (or a plain click, rect null) drops a
// standard-size shape centred on the click point; Shift squares the dragged
// rect to the larger dimension, anchored at the rect's origin corner.
function resolveRect(
  rect: Rect | null,
  at: Point,
  square: boolean
): Rect | null {
  if (
    rect !== null &&
    finiteNumber(rect.x) &&
    finiteNumber(rect.y) &&
    finiteNumber(rect.width) &&
    finiteNumber(rect.height)
  ) {
    if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
      return standardRect(at);
    }
    if (!square) return rect;
    const side = Math.max(rect.width, rect.height);
    return { x: rect.x, y: rect.y, width: side, height: side };
  }
  if (rect === null) return standardRect(at);
  return null; // non-finite rect: a contract error, not a click
}

function standardRect(at: Point): Rect | null {
  if (!finiteNumber(at.x) || !finiteNumber(at.y)) return null;
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD
  };
}

export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
  const rect = resolveRect(a.rect, a.at, a.square === true);
  if (rect === null) return null;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', rect.x);
    obj.set('y', rect.y);
    obj.set('width', rect.width);
    obj.set('height', rect.height);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// Changes only the keys given (and only when the value differs), so the
// label, size, position and selection of the shape are untouched.
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string }
): boolean {
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  if (s.fill === undefined && s.stroke === undefined) return false;
  const obj = shapeMap(doc, id);
  if (obj === undefined) return false;
  const writes: Array<['fill' | 'stroke', string]> = [];
  if (s.fill !== undefined && obj.get('fill') !== s.fill) writes.push(['fill', s.fill]);
  if (s.stroke !== undefined && obj.get('stroke') !== s.stroke) {
    writes.push(['stroke', s.stroke]);
  }
  if (writes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of writes) obj.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeMap(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}

export function getShapeFields(doc: Y.Doc, id: string): Omit<ShapeSnap, keyof ObjectSnapshot> | undefined {
  const obj = shapeMap(doc, id);
  if (obj === undefined) return undefined;
  const kind = obj.get('kind');
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const label = obj.get('label');
  if (!isShapeKind(kind) || !isFillColor(fill) || !isStrokeColor(stroke)) return undefined;
  return {
    kind,
    fill,
    stroke,
    label: label instanceof Y.Text ? label.toString() : ''
  };
}

// Snapshot view of every shape object, used by the test hooks.
export function collectShapeSnapshots(doc: Y.Doc): readonly ShapeSnap[] {
  const out: ShapeSnap[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'shape') continue;
    const fields = getShapeFields(doc, id);
    if (fields === undefined) continue;
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    const width = obj.get('width');
    const height = obj.get('height');
    out.push({
      id,
      type: 'shape',
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      z: typeof z === 'number' ? z : 0,
      width: typeof width === 'number' ? width : SHAPE_DEFAULT_SIZE_WORLD,
      height: typeof height === 'number' ? height : SHAPE_DEFAULT_SIZE_WORLD,
      ...fields
    });
  }
  return out;
}
