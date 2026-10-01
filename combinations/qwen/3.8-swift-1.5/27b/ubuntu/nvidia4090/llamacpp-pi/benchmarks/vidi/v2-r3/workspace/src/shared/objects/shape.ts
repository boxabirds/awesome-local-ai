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
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Rect, Point } from '../geometry';

const OBJECT_TYPE_SHAPE = 'shape';

/** Render-ready snapshot of a shape object. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function objectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function isShapeKind(k: unknown): k is ShapeKind {
  return typeof k === 'string' && (SHAPE_KINDS as readonly string[]).includes(k);
}

function isFillColor(c: unknown): c is FillColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, c);
}

function isStrokeColor(c: unknown): c is StrokeColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, c);
}

/**
 * Create a shape in the doc.
 *
 * - `rect` is the world-space bounding box of the drag (null for a click).
 * - `at` is the click/origin point in world units.
 * - `square` constrains the shape to a square (Shift held).
 *
 * Returns the new id, or `null` for invalid inputs (no transaction).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!isShapeKind(a.kind)) return null;

  // Validate point
  if (!isFiniteNumber(a.at.x) || !isFiniteNumber(a.at.y)) return null;

  // Determine the rect to use
  let rect: Rect;
  if (a.rect === null) {
    // Click: standard size centred on `at`
    rect = {
      x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else {
    // Validate rect
    if (
      !isFiniteNumber(a.rect.x) || !isFiniteNumber(a.rect.y) ||
      !isFiniteNumber(a.rect.width) || !isFiniteNumber(a.rect.height)
    ) return null;

    // If either dimension is below minimum, treat as click
    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      rect = {
        x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
        y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
        width: SHAPE_DEFAULT_SIZE_WORLD,
        height: SHAPE_DEFAULT_SIZE_WORLD,
      };
    } else {
      rect = { ...a.rect };
      // Square constraint: both sides = larger dimension, anchored at drag origin
      if (a.square) {
        const size = Math.max(rect.width, rect.height);
        rect.width = size;
        rect.height = size;
        // Anchor at the drag origin (top-left of the original rect)
        rect.x = a.at.x;
        rect.y = a.at.y;
      }
    }
  }

  const id = crypto.randomUUID();
  const label = new Y.Text();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', OBJECT_TYPE_SHAPE);
    m.set('x', rect.x);
    m.set('y', rect.y);
    m.set('width', rect.width);
    m.set('height', rect.height);
    m.set('kind', a.kind);
    m.set('fill', DEFAULT_SHAPE_FILL);
    m.set('stroke', DEFAULT_SHAPE_STROKE);
    m.set('label', label);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Set a shape's fill and/or stroke colour. Returns `false` for a stale id or
 * unknown colour name (no transaction).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const m = objectMap(doc, id);
  if (!m) return false;

  let fillChanged = false;
  let strokeChanged = false;

  if (s.fill !== undefined) {
    if (!isFillColor(s.fill)) return false;
    fillChanged = true;
  }
  if (s.stroke !== undefined) {
    if (!isStrokeColor(s.stroke)) return false;
    strokeChanged = true;
  }

  if (!fillChanged && !strokeChanged) return false;

  doc.transact(() => {
    if (fillChanged) m.set('fill', s.fill);
    if (strokeChanged) m.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** Return the shape's Y.Text label, or `undefined` for a stale id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('label');
  return t instanceof Y.Text ? t : undefined;
}

/**
 * Read a shape snapshot from the doc (for internal use in board-model).
 * Returns undefined if the id is not a shape.
 */
export function readShapeSnap(_doc: Y.Doc, id: string, m: Y.Map<unknown>): ShapeSnap | null {
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  const width = m.get('width');
  const height = m.get('height');
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  const kind = m.get('kind');
  const fill = m.get('fill');
  const stroke = m.get('stroke');
  const label = m.get('label');
  return {
    id,
    type: 'shape',
    x,
    y,
    z,
    width,
    height,
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}
