/**
 * Shape object model (story 10): schema helpers for `type: 'shape'` objects.
 *
 * Schema (Y.Map per object under the `objects` map):
 *   type: 'shape', kind: ShapeKind, x, y, width, height, z, createdAt,
 *   createdBy, fill: FillColor, stroke: StrokeColor, label: Y.Text
 *
 * All setters reject stale ids, unknown kinds and non-finite numbers without
 * a transaction. All writes use LOCAL_ORIGIN so story 8's undo captures them.
 */
import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type FillColor,
  type StrokeColor,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';

export type ShapeKind = typeof SHAPE_KINDS[number];

/** Shape object snapshot (story 10). */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export interface CreateShapeArgs {
  kind: ShapeKind;
  /** The dragged world rect, or null for a click (standard size at `at`). */
  rect: Rect | null;
  /** The drag origin / click point in world units. */
  at: Point;
  /** Shift held: width = height = the larger dragged dimension. */
  square?: boolean;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

function isShapeKind(kind: string): kind is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(kind);
}

/**
 * Create a new shape. A rect smaller than the minimum size in either
 * dimension (or null) creates a standard-size shape centred on `at`.
 * Returns the new id, or null for an unknown kind or non-finite input
 * (no transaction). One LOCAL_ORIGIN transaction on success.
 */
export function createShape(doc: Y.Doc, a: CreateShapeArgs, by: string): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!isFinitePair(a.at.x, a.at.y)) return null;
  if (a.rect !== null && !isFiniteRect(a.rect)) return null;

  let rect: Rect;
  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Click or tiny drag: standard size centred on the click point.
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    rect = {
      x: a.at.x - half,
      y: a.at.y - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else {
    rect = { ...a.rect };
    if (a.square) {
      // Shift: both sides = the larger dragged dimension, anchored at the
      // drag origin (the rect's top-left).
      const side = Math.max(rect.width, rect.height);
      rect.width = side;
      rect.height = side;
    }
  }

  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();
  const label = new Y.Text();
  const shape = new Y.Map<unknown>();
  shape.set('type', 'shape');
  shape.set('kind', a.kind);
  shape.set('x', rect.x);
  shape.set('y', rect.y);
  shape.set('width', rect.width);
  shape.set('height', rect.height);
  shape.set('fill', DEFAULT_SHAPE_FILL);
  shape.set('stroke', DEFAULT_SHAPE_STROKE);
  shape.set('label', label);
  shape.set('z', maxZ + 1);
  shape.set('createdAt', Date.now());
  shape.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set the fill and/or outline colour of a shape by palette name.
 * Returns true if applied, false for an unknown colour, stale id or no
 * change requested (no transaction). Only the given colour keys are touched,
 * so the label, size and position are unchanged.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (s.fill !== undefined && !(s.fill in SHAPE_FILL_COLORS)) return false;
  if (s.stroke !== undefined && !(s.stroke in SHAPE_STROKE_COLORS)) return false;
  if (s.fill === undefined && s.stroke === undefined) return false;

  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text label of a shape, or undefined if the id is stale or not a
 * shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = getObjects(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return (obj.get('label') as Y.Text | undefined) ?? undefined;
}
