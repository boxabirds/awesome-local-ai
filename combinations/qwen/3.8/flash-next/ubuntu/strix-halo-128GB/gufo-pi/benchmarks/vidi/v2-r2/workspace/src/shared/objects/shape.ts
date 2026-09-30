import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type ShapeKind,
  type FillColor,
  type StrokeColor,
} from '@shared/config';
import { LOCAL_ORIGIN, _registerTypeForModel } from '@shared/board-model';
import type { Rect, Point } from '@shared/geometry';

// Register 'shape' type with board-model
_registerTypeForModel('shape');

const VALID_KINDS = new Set<string>(SHAPE_KINDS);
const VALID_FILLS = new Set<string>(Object.keys(SHAPE_FILL_COLORS));
const VALID_STROKES = new Set<string>(Object.keys(SHAPE_STROKE_COLORS));

export interface ShapeSnap {
  id: string;
  type: 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

/**
 * Create a shape. Returns the new id, or null on invalid input.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!VALID_KINDS.has(a.kind)) return null;
  // Validate `at` is finite
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;

  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: default size centred on point
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    // Validate rect finiteness
    if (
      !Number.isFinite(a.rect.x) ||
      !Number.isFinite(a.rect.y) ||
      !Number.isFinite(a.rect.width) ||
      !Number.isFinite(a.rect.height)
    ) {
      return null;
    }

    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      // Tiny drag: treat as click, default size centred on `at`
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else if (a.square) {
      // Shift constraint: use the larger dimension for both
      const size = Math.max(a.rect.width, a.rect.height);
      width = size;
      height = size;
      x = a.rect.x;
      y = a.rect.y;
    } else {
      x = a.rect.x;
      y = a.rect.y;
      width = a.rect.width;
      height = a.rect.height;
    }
  }

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const id = crypto.randomUUID();

  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
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
 * Set the fill and/or stroke colour of a shape.
 * Returns false for stale id, wrong type, or invalid colour name.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  // Validate colours before writing
  if (s.fill !== undefined && !VALID_FILLS.has(s.fill)) return false;
  if (s.stroke !== undefined && !VALID_STROKES.has(s.stroke)) return false;

  // At least one valid key must be present
  if (s.fill === undefined && s.stroke === undefined) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Get the Y.Text label of a shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj.get('label') as Y.Text | undefined;
}

/**
 * Snapshot a shape object from the doc's objects map.
 */
export function snapshotShape(id: string, obj: Y.Map<unknown>): ShapeSnap | null {
  if (obj.get('type') !== 'shape') return null;
  return {
    id,
    type: 'shape',
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    z: obj.get('z') as number,
    createdAt: obj.get('createdAt') as number,
    createdBy: (obj.get('createdBy') as string) ?? '',
    kind: obj.get('kind') as ShapeKind,
    fill: (obj.get('fill') as FillColor) ?? DEFAULT_SHAPE_FILL,
    stroke: (obj.get('stroke') as StrokeColor) ?? DEFAULT_SHAPE_STROKE,
    label: (obj.get('label') as Y.Text).toString(),
  };
}
