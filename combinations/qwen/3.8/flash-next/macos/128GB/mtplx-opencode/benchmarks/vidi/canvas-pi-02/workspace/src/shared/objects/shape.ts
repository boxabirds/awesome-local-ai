/**
 * Shape object model (story 10).
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'shape'
 *   x, y, width, height: number (world units)
 *   kind: ShapeKind ('rect' | 'ellipse' | 'diamond')
 *   fill: string (key of SHAPE_FILL_COLORS)
 *   stroke: string (key of SHAPE_STROKE_COLORS)
 *   label: Y.Text
 *   z: number
 *   createdAt: number
 *   createdBy: string
 * }
 * ```
 */
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
} from '../config';
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

/** Shape snapshot shape. */
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

function isValidKind(kind: unknown): kind is ShapeKind {
  return typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind);
}

function finite(...values: unknown[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Create a shape on the document.
 *
 * - If `rect` is null, or either dimension is below SHAPE_MIN_SIZE_WORLD,
 *   creates a SHAPE_DEFAULT_SIZE_WORLD square centred on `at`.
 * - If `square` is true, both dimensions use the larger dragged dimension,
 *   anchored at the drag origin (top-left of the rect).
 *
 * Returns the new id, or null on invalid kind / non-finite inputs.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind.
  if (!isValidKind(a.kind)) return null;

  // Validate finiteness of at.
  if (!finite(a.at?.x, a.at?.y)) return null;

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (a.rect === null) {
    // Click-to-drop: default size centred at `at`.
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    // Validate rect finiteness.
    if (!finite(a.rect.x, a.rect.y, a.rect.width, a.rect.height)) return null;

    // Check if below minimum size in either dimension → default size.
    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else if (a.square) {
      // Square constraint: use the larger dimension anchored at drag origin.
      const side = Math.max(a.rect.width, a.rect.height);
      width = side;
      height = side;
      x = a.rect.x;
      y = a.rect.y;
    } else {
      x = a.rect.x;
      y = a.rect.y;
      width = a.rect.width;
      height = a.rect.height;
    }
  }

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `shape-${Math.random().toString(36).slice(2)}`;

  // Compute z.
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let maxZ = 0;
  objects.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > maxZ) maxZ = z;
  });

  const z = maxZ + 1;

  doc.transact(() => {
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('x', x);
    shape.set('y', y);
    shape.set('width', width);
    shape.set('height', height);
    shape.set('kind', a.kind);
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text());
    shape.set('z', z);
    shape.set('createdAt', Date.now());
    shape.set('createdBy', by);
    objects.set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set fill and/or stroke on a shape.
 *
 * Returns false for: stale id, unknown colour name, or if the object is not a shape.
 * Only touches the keys provided. One LOCAL_ORIGIN transaction on success.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'shape') return false;

  // Validate colours.
  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;

  // Check if anything actually changes.
  const changed =
    (s.fill !== undefined && obj.get('fill') !== s.fill) ||
    (s.stroke !== undefined && obj.get('stroke') !== s.stroke);
  if (!changed) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** Return the shape's label Y.Text, or undefined if the shape is gone. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!(obj instanceof Y.Map) || obj.get('type') !== 'shape') return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** True if the value is a shape Y.Map. */
export function isShape(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map && value.get('type') === 'shape';
}
