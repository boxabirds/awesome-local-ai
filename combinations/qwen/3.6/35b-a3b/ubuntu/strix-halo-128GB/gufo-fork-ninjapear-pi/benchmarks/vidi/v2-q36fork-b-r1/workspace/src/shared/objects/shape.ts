import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '@/shared/config';
import type { ObjectSnapshot } from '@/shared/board-model';
import { LOCAL_ORIGIN } from '@/shared/board-model';

export type ShapeKind = typeof SHAPE_KINDS[number];
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** Shape object stored in the Y.Doc. */
interface ShapeInner {
  type: 'shape';
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: FillColor;
  stroke: StrokeColor;
  label: Y.Text;
  z: number;
  createdBy: string;
  createdAt: number;
}

/** Flat snapshot for rendering. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

/** Rectangular region in world space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Point in world space. */
export interface Point {
  x: number;
  y: number;
}

// ---- Exports re-exported config for convenience ----
export { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS };

// ---- Helpers ----

function getObjectsMap(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects');
}

function getField(inner: any, key: string): any {
  try {
    return inner.get(key);
  } catch {
    return undefined;
  }
}

function setField(inner: any, key: string, val: any): void {
  inner.set(key, val);
}

function getMaxZ(objects: Y.Map<any>): number {
  let max = 0;
  objects.forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(getField(inner, 'z'));
      if (z > max) max = z;
    }
  });
  return max;
}

// ---- Public API ----

/**
 * Create a shape. Returns the new id or null on error.
 * - `rect` null or below min in either dimension → default-size centred at `at`.
 * - `square` true → both sides = larger of width/height, anchored at drag origin.
 * - One LOCAL_ORIGIN transaction per success.
 */
export function createShape(
  doc: Y.Doc,
  opts: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!SHAPE_KINDS.includes(opts.kind)) return null;

  // Validate finiteness
  if (!isFinite(opts.at.x) || !isFinite(opts.at.y)) return null;

  // If rect is provided but has non-finite values → reject entirely
  if (opts.rect && (!isFinite(opts.rect.x) || !isFinite(opts.rect.y) || !isFinite(opts.rect.width) || !isFinite(opts.rect.height))) {
    return null;
  }

  // Click or tiny drag → default size centred at at point
  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (opts.rect) {
    x = opts.rect.x;
    y = opts.rect.y;
    width = opts.rect.width;
    height = opts.rect.height;

    // Click or tiny drag → default size centred at at point
    const useDefaultSize =
      width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD;
    if (useDefaultSize) {
      x = opts.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2;
      y = opts.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2;
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
    }

    // Square constraint
    if (opts.square) {
      const side = Math.max(width, height);
      height = side;
      width = side;
    }
  } else {
    x = opts.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2;
    y = opts.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2;
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
  }

  const objects = getObjectsMap(doc);
  const maxZ = getMaxZ(objects);
  const id = crypto.randomUUID();
  const inner = new Y.Map() as Y.Map<unknown>;

  doc.transact(() => {
    setField(inner, 'type', 'shape');
    setField(inner, 'kind', opts.kind);
    setField(inner, 'x', x);
    setField(inner, 'y', y);
    setField(inner, 'width', width);
    setField(inner, 'height', height);
    setField(inner, 'fill', DEFAULT_SHAPE_FILL);
    setField(inner, 'stroke', DEFAULT_SHAPE_STROKE);
    setField(inner, 'label', new Y.Text());
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdBy', by);
    setField(inner, 'createdAt', Date.now());
    (objects as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set shape style (fill and/or stroke). Returns false on invalid inputs.
 * Validates colour names against palettes.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  // Validate fill if provided
  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  // Validate stroke if provided
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;

  doc.transact(() => {
    if (s.fill !== undefined) {
      setField(inner, 'fill', s.fill);
    }
    if (s.stroke !== undefined) {
      setField(inner, 'stroke', s.stroke);
    }
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text label for a shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return undefined;
  const labelVal = getField(inner, 'label');
  if (labelVal instanceof Y.Text) return labelVal;
  return undefined;
}
