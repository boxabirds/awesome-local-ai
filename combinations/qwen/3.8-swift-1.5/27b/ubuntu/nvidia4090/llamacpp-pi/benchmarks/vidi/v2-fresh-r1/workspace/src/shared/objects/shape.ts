// Shape object model (story 10): create, style, label.
// Shared by the client now; framework-free.

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
import { LOCAL_ORIGIN, getObjects, getMaxZ, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export type { ShapeKind, FillColor, StrokeColor };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isFinitePoint(p: Point): boolean {
  return isFiniteNum(p.x) && isFiniteNum(p.y);
}

function isFiniteRect(r: Rect): boolean {
  return isFiniteNum(r.x) && isFiniteNum(r.y) && isFiniteNum(r.width) && isFiniteNum(r.height);
}

function isValidKind(kind: string): kind is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(kind);
}

/**
 * Create a new shape on the board.
 * - `rect` is the world-space rectangle for a drag; null means a click.
 * - `at` is the click point (or drag origin for anchoring).
 * - `square` constrains to a square (Shift).
 * Returns the new id, or null on invalid input.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!isValidKind(a.kind)) return null;
  // Validate point
  if (!isFinitePoint(a.at)) return null;

  let x: number, y: number, w: number, h: number;

  if (a.rect === null) {
    // Click: default size centred at `at`
    w = SHAPE_DEFAULT_SIZE_WORLD;
    h = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - w / 2;
    y = a.at.y - h / 2;
  } else {
    if (!isFiniteRect(a.rect)) return null;
    if (a.square) {
      // Shift: use the larger dimension, anchored at the drag origin
      const size = Math.max(a.rect.width, a.rect.height);
      w = size;
      h = size;
      // Anchor at the drag origin. The shape extends from `at` in the
      // direction the drag went. If the rect's top-left is to the left of
      // `at`, the drag went left, so the shape extends left from `at`.
      const dx = a.rect.x - a.at.x;
      const dy = a.rect.y - a.at.y;
      x = dx < 0 ? a.at.x - size : a.at.x;
      y = dy < 0 ? a.at.y - size : a.at.y;
    } else {
      w = a.rect.width;
      h = a.rect.height;
      x = a.rect.x;
      y = a.rect.y;
    }

    // Below minimum size in either dimension → default size centred at `at`
    if (w < SHAPE_MIN_SIZE_WORLD || h < SHAPE_MIN_SIZE_WORLD) {
      w = SHAPE_DEFAULT_SIZE_WORLD;
      h = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - w / 2;
      y = a.at.y - h / 2;
    }
  }

  const id = crypto.randomUUID();
  const label = new Y.Text();

  doc.transact(() => {
    const objects = getObjects(doc);
    const shape = new Y.Map();
    shape.set('type', 'shape');
    shape.set('kind', a.kind);
    shape.set('x', x);
    shape.set('y', y);
    shape.set('width', w);
    shape.set('height', h);
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', label);
    shape.set('z', getMaxZ(doc) + 1);
    shape.set('createdAt', Date.now());
    shape.set('createdBy', by);
    objects.set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set the fill and/or stroke colour of a shape.
 * Returns true if applied, false if id is stale or colour is unknown.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  // Validate colours
  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;

  // Nothing to change
  if (s.fill === undefined && s.stroke === undefined) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text label for a shape, or undefined if the id is stale.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const label = obj.get('label');
  if (label instanceof Y.Text) return label;
  return undefined;
}
