// Shape objects (story 10, shape.model contract): document schema and model
// operations for the three shape kinds (rect, ellipse, diamond).
//
//   objects.<id> : {
//     type:      'shape'
//     x, y, z:   number
//     width:     number   // persisted (unlike stickies, shapes always store
//     height:    number   // their box at creation)
//     kind:      ShapeKind
//     fill:      FillColor
//     stroke:    StrokeColor
//     label:     Y.Text
//     createdAt: number
//     createdBy: string
//   }

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
import {
  LOCAL_ORIGIN,
  nextZAboveAll,
  newObjectId,
  objects,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';

export type { ShapeKind, FillColor, StrokeColor };

/** Snapshot of a shape object (ObjectSnapshot plus the shape fields). */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  /** The label's current text. */
  label: string;
}

const SHAPE_TYPE = 'shape';

function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === 'string' && (SHAPE_KINDS as readonly string[]).includes(v);
}

/**
 * The world rect a creation produces (shape.create_drag / shape.create_click
 * / shape.constrain), shared by createShape and the tool's live preview:
 * - rect null or below SHAPE_MIN_SIZE_WORLD in either dimension: a
 *   SHAPE_DEFAULT_SIZE_WORLD square centred on `at`;
 * - square (Shift held): both sides = the larger dragged dimension, anchored
 *   at the drag origin (`at`);
 * - otherwise: exactly `rect`.
 */
export function shapeRect(
  rect: Rect | null,
  at: Point,
  square: boolean,
): Rect {
  if (rect === null ||
      rect.width < SHAPE_MIN_SIZE_WORLD ||
      rect.height < SHAPE_MIN_SIZE_WORLD) {
    return {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (square) {
    const side = Math.max(rect.width, rect.height);
    return {
      x: at.x === rect.x ? rect.x : at.x - side,
      y: at.y === rect.y ? rect.y : at.y - side,
      width: side,
      height: side,
    };
  }
  return rect;
}

/**
 * Create a shape (shape.create_drag / shape.create_click / shape.constrain).
 *
 * - `rect` null (a click) or below SHAPE_MIN_SIZE_WORLD in either dimension:
 *   a SHAPE_DEFAULT_SIZE_WORLD square centred on `at`.
 * - `square: true` (Shift held): both sides = the larger dragged dimension,
 *   anchored at the drag origin (`at`).
 * - otherwise: exactly `rect`.
 *
 * Returns the new id, or null (no transaction) for an unknown kind or a
 * non-finite rect/point. One LOCAL_ORIGIN transaction per success;
 * z = maxZ + 1, createdBy = `by`.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;
  const rect = a.rect;
  if (rect !== null &&
      (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
       !Number.isFinite(rect.width) || !Number.isFinite(rect.height))) {
    return null;
  }

  const { x, y, width, height } = shapeRect(a.rect, a.at, a.square ?? false);

  const id = newObjectId();
  const label = new Y.Text();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', SHAPE_TYPE);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', label);
    obj.set('z', nextZAboveAll(doc));
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a shape's fill and/or outline (shape.style). Unknown colour names,
 * an empty change, a stale id or a no-op colour return false without a
 * transaction; only the colour keys are ever written (the label, size,
 * position and selection are untouched).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  let fill: FillColor | undefined;
  let stroke: StrokeColor | undefined;
  if (s.fill !== undefined) {
    if (typeof s.fill !== 'string' || !(s.fill in SHAPE_FILL_COLORS)) return false;
    fill = s.fill as FillColor;
  }
  if (s.stroke !== undefined) {
    if (typeof s.stroke !== 'string' || !(s.stroke in SHAPE_STROKE_COLORS)) return false;
    stroke = s.stroke as StrokeColor;
  }
  if (fill === undefined && stroke === undefined) return false;
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== SHAPE_TYPE) return false;
  if (
    (fill === undefined || obj.get('fill') === fill) &&
    (stroke === undefined || obj.get('stroke') === stroke)
  ) {
    return false;
  }
  doc.transact(() => {
    if (fill !== undefined) obj.set('fill', fill);
    if (stroke !== undefined) obj.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's label Y.Text, or undefined when the object is missing. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== SHAPE_TYPE) return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}
