/**
 * Shape object model (story 10).
 *
 * Schema: type 'shape', x, y, width, height, z, createdAt, createdBy,
 *         kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
 *
 * All mutations go through `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
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
  type StrokeColor,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

const VALID_KINDS: ReadonlySet<string> = new Set<string>(SHAPE_KINDS);
const VALID_FILLS: ReadonlySet<string> = new Set(Object.keys(SHAPE_FILL_COLORS));
const VALID_STROKES: ReadonlySet<string> = new Set(Object.keys(SHAPE_STROKE_COLORS));

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

/**
 * Create a shape.
 *
 * - `rect` null → default-size shape centred at `at` (click).
 * - `rect` smaller than SHAPE_MIN_SIZE_WORLD in either dimension → same as click.
 * - `square: true` → both dimensions equal the larger of the dragged dims, anchored at the rect origin.
 *
 * Returns the new id, or null on invalid kind / non-finite values.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!VALID_KINDS.has(a.kind)) return null;
  // Validate point finiteness
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;

  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: default size centred at `at`
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    // Validate rect finiteness
    if (!Number.isFinite(a.rect.x) || !Number.isFinite(a.rect.y) ||
        !Number.isFinite(a.rect.width) || !Number.isFinite(a.rect.height)) return null;

    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      // Tiny drag → click behaviour
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else {
      x = a.rect.x;
      y = a.rect.y;
      width = a.rect.width;
      height = a.rect.height;

      // Shift constraint: make it square using the larger dimension
      if (a.square) {
        const side = Math.max(width, height);
        width = side;
        height = side;
        // Anchor at the rect origin (top-left of the drag)
        x = a.rect.x;
        y = a.rect.y;
      }
    }
  }

  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const z = maxZ(objects) + 1;

  doc.transact(() => {
    if (objects.has(id)) return;
    const yMap = new Y.Map();
    objects.set(id, yMap);
    yMap.set('type', 'shape');
    yMap.set('kind', a.kind);
    yMap.set('x', x);
    yMap.set('y', y);
    yMap.set('width', width);
    yMap.set('height', height);
    yMap.set('fill', DEFAULT_SHAPE_FILL);
    yMap.set('stroke', DEFAULT_SHAPE_STROKE);
    yMap.set('z', z);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', by);
    const yText = new Y.Text();
    yMap.set('label', yText);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set fill and/or stroke on a shape.
 * Returns false for unknown colours, non-shape ids, or stale ids.
 * Only colour keys are touched; label, size, position and z remain unchanged.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill !== undefined && !VALID_FILLS.has(s.fill)) return false;
  if (s.stroke !== undefined && !VALID_STROKES.has(s.stroke)) return false;

  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text label of a shape, or undefined if not found.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj.get('label') as Y.Text;
}
