/**
 * Story 10: shape object model.
 *
 * Schema (per object id in the `objects` Y.Map):
 * ```
 * Y.Map {
 *   type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *   kind: ShapeKind, fill: FillColor, stroke: StrokeColor,
 *   label: Y.Text
 * }
 * ```
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import {
  SHAPE_KINDS, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE,
  type ShapeKind, type FillColor, type StrokeColor,
} from '../config';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

/** Cast a generic snapshot to its shape flavour. */
export function asShape(snap: ObjectSnapshot): ShapeSnap {
  return snap as ShapeSnap;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  let maxZ = 0;
  objectsMap(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height)
  );
}

function isValidKind(kind: string): kind is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(kind);
}

/**
 * Create a shape object.
 *
 * - `rect` is the world-space rect to create (null for a click → default size centred at `at`).
 * - If `rect` is non-null but either dimension < SHAPE_MIN_SIZE_WORLD, it's treated as a click.
 * - `square: true` makes width = height = max(w, h), anchored at the rect origin.
 * - Unknown kind or non-finite inputs → null, no transaction.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  const { kind, rect, at, square } = a;

  if (!isValidKind(kind)) return null;
  if (!isFinitePoint(at)) return null;

  let finalRect: Rect;

  if (rect === null) {
    // Click: default size centred at `at`
    finalRect = {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else {
    if (!isFiniteRect(rect)) return null;

    if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
      // Too small: treat as click, default size centred at `at`
      finalRect = {
        x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
        y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
        width: SHAPE_DEFAULT_SIZE_WORLD,
        height: SHAPE_DEFAULT_SIZE_WORLD,
      };
    } else {
      if (square) {
        const size = Math.max(rect.width, rect.height);
        finalRect = { x: rect.x, y: rect.y, width: size, height: size };
      } else {
        finalRect = { ...rect };
      }
    }
  }

  const id = crypto.randomUUID();
  const label = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'shape');
  obj.set('x', finalRect.x);
  obj.set('y', finalRect.y);
  obj.set('width', finalRect.width);
  obj.set('height', finalRect.height);
  obj.set('kind', kind);
  obj.set('fill', DEFAULT_SHAPE_FILL);
  obj.set('stroke', DEFAULT_SHAPE_STROKE);
  obj.set('label', label);
  obj.set('z', getMaxZ(doc) + 1);
  obj.set('createdAt', Date.now());
  obj.set('createdBy', by);

  doc.transact(() => {
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set fill and/or stroke colour on a shape.
 * Unknown colour names → false, no transaction. Stale id → false.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;

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
  const obj = objectsMap(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  const text = obj.get('label');
  return text instanceof Y.Text ? text : undefined;
}
