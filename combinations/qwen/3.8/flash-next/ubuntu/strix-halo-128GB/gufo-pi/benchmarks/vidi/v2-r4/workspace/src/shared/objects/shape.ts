/**
 * Shape object model: schema helpers for the 'shape' object type.
 *
 * Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * Rejections return null/false before opening a transaction, so no update event is emitted.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../local-origin';
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
} from '../config';
import type { Rect } from '../geometry';
import type { Point } from '../../client/canvas/camera';

const VALID_KINDS = new Set<string>(SHAPE_KINDS);
const VALID_FILLS = new Set<string>(Object.keys(SHAPE_FILL_COLORS));
const VALID_STROKES = new Set<string>(Object.keys(SHAPE_STROKE_COLORS));

export interface ShapeSnap {
  id: string;
  type: 'shape';
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  z: number;
  createdAt: number;
  createdBy: string;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const obj of objects.values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

/**
 * Create a shape. If `rect` is null or its width/height are both below
 * SHAPE_MIN_SIZE_WORLD, a standard SHAPE_DEFAULT_SIZE_WORLD shape is created
 * centred on `at`. If `square` is true, width and height are set to the larger
 * of the two dragged dimensions, anchored at the drag origin.
 *
 * Returns the new id, or null for invalid kind or non-finite rect/point.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!VALID_KINDS.has(a.kind)) return null;

  let finalX: number;
  let finalY: number;
  let finalW: number;
  let finalH: number;

  if (a.rect === null) {
    // Click behaviour: default size centred on `at`
    if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
    finalW = SHAPE_DEFAULT_SIZE_WORLD;
    finalH = SHAPE_DEFAULT_SIZE_WORLD;
    finalX = a.at.x - finalW / 2;
    finalY = a.at.y - finalH / 2;
  } else {
    // Validate finiteness
    if (
      !Number.isFinite(a.rect.x) ||
      !Number.isFinite(a.rect.y) ||
      !Number.isFinite(a.rect.width) ||
      !Number.isFinite(a.rect.height)
    ) {
      return null;
    }

    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      // Too small: treat as a click, use default size centred on `at`
      finalW = SHAPE_DEFAULT_SIZE_WORLD;
      finalH = SHAPE_DEFAULT_SIZE_WORLD;
      finalX = a.at.x - finalW / 2;
      finalY = a.at.y - finalH / 2;
    } else if (a.square) {
      // Constrain: both dimensions = larger, anchored at the drag origin
      const larger = Math.max(a.rect.width, a.rect.height);
      finalW = larger;
      finalH = larger;
      finalX = a.rect.x;
      finalY = a.rect.y;
    } else {
      // Use rect as-is (including the boundary case: exactly 20x20 is kept)
      finalW = a.rect.width;
      finalH = a.rect.height;
      finalX = a.rect.x;
      finalY = a.rect.y;
    }
  }

  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', finalX);
    obj.set('y', finalY);
    obj.set('width', finalW);
    obj.set('height', finalH);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(objects) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change fill and/or stroke of a shape. Returns false for stale id or unknown colour.
 * Only provided keys are changed; other properties (label, size, position) are untouched.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  // Validate colours before opening transaction
  if (s.fill !== undefined && !VALID_FILLS.has(s.fill)) return false;
  if (s.stroke !== undefined && !VALID_STROKES.has(s.stroke)) return false;

  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** Return the Y.Text label of a shape for the text editor. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** Read a shape object from the Y.Map. Returns null if type !== 'shape'. */
export function readShape(id: string, obj: Y.Map<unknown>): ShapeSnap | null {
  if (obj.get('type') !== 'shape') return null;
  const kind = obj.get('kind');
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const label = obj.get('label');
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const createdBy = obj.get('createdBy');
  return {
    id,
    type: 'shape',
    kind: VALID_KINDS.has(String(kind)) ? (kind as ShapeKind) : 'rect',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    width: typeof width === 'number' ? width : 160,
    height: typeof height === 'number' ? height : 160,
    fill: VALID_FILLS.has(String(fill)) ? (fill as FillColor) : DEFAULT_SHAPE_FILL,
    stroke: VALID_STROKES.has(String(stroke)) ? (stroke as StrokeColor) : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}
