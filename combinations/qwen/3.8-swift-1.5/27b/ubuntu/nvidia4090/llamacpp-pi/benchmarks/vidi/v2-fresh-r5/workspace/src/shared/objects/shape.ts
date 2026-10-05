/**
 * Shape object model (story 10). Schema helpers for creating and modifying
 * shape objects in the Y.Doc.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
} from '../board-model';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type ShapeKind,
} from '../config';
import type { Rect, Point } from '../geometry';

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isFiniteCoord(n: number): boolean {
  return Number.isFinite(n);
}

function isFiniteRect(r: Rect): boolean {
  return isFiniteCoord(r.x) && isFiniteCoord(r.y) && isFiniteCoord(r.width) && isFiniteCoord(r.height);
}

function isFinitePoint(p: Point): boolean {
  return isFiniteCoord(p.x) && isFiniteCoord(p.y);
}

/**
 * Create a new shape in the document.
 *
 * - If `rect` is null or has width < SHAPE_MIN_SIZE_WORLD or height < SHAPE_MIN_SIZE_WORLD,
 *   creates a SHAPE_DEFAULT_SIZE_WORLD square centred at `at`.
 * - If `square` is true, width and height are both set to the larger dimension,
 *   anchored at the drag origin (`at`).
 *
 * Returns the new shape's id, or null if kind is unknown or coordinates are non-finite.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!SHAPE_KINDS.includes(a.kind)) return null;
  // Validate point
  if (!isFinitePoint(a.at)) return null;

  let x: number, y: number, width: number, height: number;

  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Click behaviour: default size centred at `at`
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    if (!isFiniteRect(a.rect)) return null;
    x = a.rect.x;
    y = a.rect.y;
    width = a.rect.width;
    height = a.rect.height;

    if (a.square) {
      const size = Math.max(width, height);
      width = size;
      height = size;
      // Anchored at drag origin
      x = a.at.x;
      y = a.at.y;
    }
  }

  const id = crypto.randomUUID();
  const objects = getObjects(doc);

  // Compute maxZ
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });

  const shapeMap = new Y.Map<unknown>();
  const label = new Y.Text();
  shapeMap.set('type', 'shape');
  shapeMap.set('x', x);
  shapeMap.set('y', y);
  shapeMap.set('width', width);
  shapeMap.set('height', height);
  shapeMap.set('kind', a.kind);
  shapeMap.set('fill', DEFAULT_SHAPE_FILL);
  shapeMap.set('stroke', DEFAULT_SHAPE_STROKE);
  shapeMap.set('text', label);
  shapeMap.set('z', maxZ + 1);
  shapeMap.set('createdAt', Date.now());
  shapeMap.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, shapeMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set a shape's fill and/or stroke colour. Returns true if applied.
 * Validates against SHAPE_FILL_COLORS / SHAPE_STROKE_COLORS.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text label for a shape, or undefined if the id is unknown.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return obj.get('text') as Y.Text | undefined;
}
