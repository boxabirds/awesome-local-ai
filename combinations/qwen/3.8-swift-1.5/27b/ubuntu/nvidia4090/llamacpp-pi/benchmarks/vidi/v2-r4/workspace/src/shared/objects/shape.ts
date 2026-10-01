import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Rect, Point } from '../geometry';

export type ShapeKind = typeof SHAPE_KINDS[number];
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  width: number;
  height: number;
  createdAt: number;
  createdBy: string;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

function isValidKind(kind: string): kind is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(kind);
}

function isValidFill(color: string): color is FillColor {
  return color in SHAPE_FILL_COLORS;
}

function isValidStroke(color: string): color is StrokeColor {
  return color in SHAPE_STROKE_COLORS;
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  getObjects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!isValidKind(a.kind)) return null;

  // Validate point
  if (!isFinitePoint(a.at.x, a.at.y)) return null;

  // Determine the rect
  let rect: Rect;
  if (a.rect === null) {
    // Click: standard size centred at point
    const size = SHAPE_DEFAULT_SIZE_WORLD;
    rect = {
      x: a.at.x - size / 2,
      y: a.at.y - size / 2,
      width: size,
      height: size,
    };
  } else {
    // Validate rect
    if (!isFiniteRect(a.rect)) return null;

    // Check minimum size: if either dimension is below min, use default
    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      const size = SHAPE_DEFAULT_SIZE_WORLD;
      rect = {
        x: a.at.x - size / 2,
        y: a.at.y - size / 2,
        width: size,
        height: size,
      };
    } else {
      rect = { ...a.rect };
    }
  }

  // Square constraint (Shift held)
  if (a.square) {
    const size = Math.max(rect.width, rect.height);
    rect = {
      x: rect.x,
      y: rect.y,
      width: size,
      height: size,
    };
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

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
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    getObjects(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  let fillChanged = false;
  let strokeChanged = false;

  if (s.fill !== undefined) {
    if (!isValidFill(s.fill)) return false;
    if (obj.get('fill') !== s.fill) fillChanged = true;
  }

  if (s.stroke !== undefined) {
    if (!isValidStroke(s.stroke)) return false;
    if (obj.get('stroke') !== s.stroke) strokeChanged = true;
  }

  if (!fillChanged && !strokeChanged) return false;

  doc.transact(() => {
    if (fillChanged && s.fill !== undefined) obj.set('fill', s.fill);
    if (strokeChanged && s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  const text = obj.get('label');
  return text instanceof Y.Text ? text : undefined;
}
