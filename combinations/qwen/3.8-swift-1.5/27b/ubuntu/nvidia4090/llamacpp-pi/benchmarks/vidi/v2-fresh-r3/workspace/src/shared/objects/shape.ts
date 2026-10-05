import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../config';
import type { Rect, Point } from '../geometry';

export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function shapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && value in SHAPE_FILL_COLORS;
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && value in SHAPE_STROKE_COLORS;
}

/**
 * Creates a shape of the given kind. When `rect` is null (a click) or below
 * SHAPE_MIN_SIZE_WORLD in either dimension, a standard SHAPE_DEFAULT_SIZE_WORLD
 * square is created centred on `at`. When `square` is true, both dimensions
 * are set to the larger of the two (anchored at the drag origin).
 *
 * Returns the new id, or null for unknown kind, non-finite rect/point
 * (no transaction opened).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;

  let x: number, y: number, width: number, height: number;

  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Click behaviour: standard size centred on `at`
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    width = a.rect.width;
    height = a.rect.height;
    x = a.rect.x;
    y = a.rect.y;

    if (a.square) {
      const s = Math.max(width, height);
      width = s;
      height = s;
      // Anchored at drag origin (top-left of the original rect)
      x = a.rect.x;
      y = a.rect.y;
    }
  }

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const id = crypto.randomUUID();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'shape');
  obj.set('kind', a.kind);
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('fill', DEFAULT_SHAPE_FILL);
  obj.set('stroke', DEFAULT_SHAPE_STROKE);
  obj.set('label', new Y.Text());
  obj.set('z', maxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Sets the fill and/or stroke colour. Validates against the palettes.
 * Returns false (no transaction) for stale ids or unknown colour names.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const fill = s.fill !== undefined ? isFillColor(s.fill) ? s.fill as FillColor : null : null;
  const stroke = s.stroke !== undefined ? isStrokeColor(s.stroke) ? s.stroke as StrokeColor : null : null;

  if (s.fill !== undefined && fill === null) return false;
  if (s.stroke !== undefined && stroke === null) return false;
  if (fill === null && stroke === null) return false;

  const obj = shapeMap(doc, id);
  if (!obj) return false;

  doc.transact(() => {
    if (fill !== null) obj.set('fill', fill);
    if (stroke !== null) obj.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's Y.Text label, or undefined for stale/unknown ids. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = shapeMap(doc, id);
  if (!obj) return undefined;
  const text = obj.get('label');
  return text instanceof Y.Text ? text : undefined;
}
