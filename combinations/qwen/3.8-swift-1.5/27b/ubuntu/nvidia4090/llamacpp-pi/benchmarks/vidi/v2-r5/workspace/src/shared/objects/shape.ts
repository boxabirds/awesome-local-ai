// src/shared/objects/shape.ts
// Shape object schema helpers: create, set style, get label.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
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
import type { ObjectSnapshot } from '../board-model';

export type { ShapeKind, FillColor, StrokeColor };

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  width: number;
  height: number;
  createdAt: number;
  createdBy: string;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isValidKind(kind: string): kind is ShapeKind {
  return (SHAPE_KINDS as readonly string[]).includes(kind);
}

function isValidFill(color: string): color is FillColor {
  return color in SHAPE_FILL_COLORS;
}

function isValidStroke(color: string): color is StrokeColor {
  return color in SHAPE_STROKE_COLORS;
}

function isFiniteCoord(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

/**
 * Creates a shape on the board.
 * - rect null → default size centred at `at`
 * - rect below SHAPE_MIN_SIZE_WORLD in either dimension → default size centred at `at`
 * - square: true → both sides = max(width, height), anchored at rect origin
 * - Valid rect → use as-is
 *
 * Returns the new id, or null for unknown kind / non-finite rect.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!isValidKind(a.kind)) return null;

  // Validate point
  if (!isFiniteCoord(a.at.x, a.at.y)) return null;

  // Determine the final rect
  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: default size centred at `at`
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    if (!isFiniteRect(a.rect)) return null;

    width = a.rect.width;
    height = a.rect.height;
    x = a.rect.x;
    y = a.rect.y;

    // Below minimum size in either dimension → default size centred at `at`
    if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) {
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else {
      // Square constraint: both sides = larger dimension, anchored at drag origin
      if (a.square) {
        const size = Math.max(width, height);
        width = size;
        height = size;
      }
    }
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;
  const label = new Y.Text();

  doc.transact(() => {
    const objects = getObjects(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', label);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Sets the fill and/or stroke colour of a shape.
 * Returns false for unknown colour names or stale ids.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  // Validate colours
  if (s.fill !== undefined && !isValidFill(s.fill)) return false;
  if (s.stroke !== undefined && !isValidStroke(s.stroke)) return false;

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
 * Returns the Y.Text label of a shape, or undefined if not found.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj.get('label') as Y.Text | undefined;
}
