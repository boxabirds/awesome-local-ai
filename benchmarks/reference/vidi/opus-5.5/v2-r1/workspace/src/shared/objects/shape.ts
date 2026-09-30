// Shapes (story 10): rectangles, ellipses and diamonds with a fill, an outline and a centred
// label. Framework-free.
//
// objects/<id>: Y.Map {
//   type: 'shape', x, y, width, height, z, createdAt, createdBy,
//   kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
// }
import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type FillColor,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type StrokeColor,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { type Point, type Rect, isFiniteRect } from '../geometry';

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeSnap extends ObjectSnapshot {
  readonly type: 'shape';
  readonly kind: ShapeKind;
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  readonly label: string;
}

export function isShapeKind(kind: unknown): kind is ShapeKind {
  return typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind);
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

/** The shape-specific fields of a stored shape, with defaults for missing or unknown values. */
export function readShapeFields(obj: Y.Map<unknown>): Pick<ShapeSnap, 'kind' | 'fill' | 'stroke' | 'label'> {
  const kind = obj.get('kind');
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const label = obj.get('label');
  return {
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}

function shapeObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = doc.getMap('objects').get(id);
  return obj instanceof Y.Map && obj.get('type') === 'shape' ? (obj as Y.Map<unknown>) : undefined;
}

/**
 * The rect a shape gesture creates. `rect` is the dragged area (null for a click) and `at` the
 * press point. With `square`, both sides become the larger dragged dimension, anchored at the
 * press point. A click, or an area below SHAPE_MIN_SIZE_WORLD in either direction, gives a
 * standard SHAPE_DEFAULT_SIZE_WORLD square centred on `at`.
 */
export function shapeRect(rect: Rect | null, at: Point, square = false): Rect {
  let r = rect;
  if (r && square) {
    const s = Math.max(r.width, r.height);
    const leftward = at.x > r.x + r.width / 2;
    const upward = at.y > r.y + r.height / 2;
    r = { x: leftward ? at.x - s : at.x, y: upward ? at.y - s : at.y, width: s, height: s };
  }
  if (!r || r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    return { x: at.x - s / 2, y: at.y - s / 2, width: s, height: s };
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * Creates a shape (white fill, dark outline, empty label) on top of every other object; see
 * `shapeRect` for its size. Returns the new id, or null for an unknown kind or a non-finite
 * rect or point (nothing written).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
  if (a.rect && (!isFiniteRect(a.rect) || a.rect.width < 0 || a.rect.height < 0)) return null;
  const r = shapeRect(a.rect, a.at, a.square ?? false);
  const id = crypto.randomUUID();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((o) => {
      const z = o instanceof Y.Map ? o.get('z') : undefined;
      if (typeof z === 'number' && Number.isFinite(z)) maxZ = Math.max(maxZ, z);
    });
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('z', maxZ + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Changes only the fill and/or outline colour. False for a stale id, an unknown colour (nothing
 * is written, even for the other key) or no change.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill === undefined && s.stroke === undefined) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  const obj = shapeObject(doc, id);
  if (!obj) return false;
  const fill = s.fill !== undefined && obj.get('fill') !== s.fill;
  const stroke = s.stroke !== undefined && obj.get('stroke') !== s.stroke;
  if (!fill && !stroke) return false;
  doc.transact(() => {
    if (fill) obj.set('fill', s.fill);
    if (stroke) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeObject(doc, id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}
