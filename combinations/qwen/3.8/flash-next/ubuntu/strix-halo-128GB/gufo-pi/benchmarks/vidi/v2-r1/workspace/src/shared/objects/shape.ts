/**
 * Shape object model: schema helpers for creating and mutating shape objects
 * stored in the Y.Doc objects map.
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *   kind: ShapeKind,
 *   fill: FillColor,
 *   stroke: StrokeColor,
 *   label: Y.Text
 * }
 * ```
 */

import * as Y from 'yjs';

import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  isFillColor,
  isShapeKind,
  isStrokeColor,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config';
import {
  LOCAL_ORIGIN,
  type ObjectSnapshot,
  type Point,
} from '../board-model';
import type { Rect } from '../geometry';

const OBJECTS_MAP = 'objects';

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown> | undefined> {
  return doc.getMap(OBJECTS_MAP) as unknown as Y.Map<Y.Map<unknown> | undefined>;
}

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string') return undefined;
  const entry = objectsOf(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
}

function isShapeEntry(entry: Y.Map<unknown> | undefined): entry is Y.Map<unknown> {
  return entry !== undefined && entry.get('type') === 'shape';
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Highest `z` currently in the document (over every object type). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    const z = entry instanceof Y.Map ? entry.get('z') : undefined;
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/**
 * Create a shape object. Returns the new id, or null for invalid kind or non-finite rect/point.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!isShapeKind(a.kind)) return null;

  // Validate at point
  if (!a.at || !isFiniteNum(a.at.x) || !isFiniteNum(a.at.y)) return null;

  // If rect is provided but non-finite → reject
  if (a.rect !== null) {
    if (!isFiniteNum(a.rect.x) || !isFiniteNum(a.rect.y) || !isFiniteNum(a.rect.width) || !isFiniteNum(a.rect.height)) {
      return null;
    }
  }

  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: use default size centred at point
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    x = a.at.x - half;
    y = a.at.y - half;
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
  } else if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Drag too small: treated as a click, use default size centred at the drag origin
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    x = a.at.x - half;
    y = a.at.y - half;
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
  } else if (a.square) {
    // Shift held: make it a square using the larger dimension, anchored at drag origin
    const size = Math.max(a.rect.width, a.rect.height);
    x = a.rect.x;
    y = a.rect.y;
    width = size;
    height = size;
  } else {
    // Normal drag: use the rect as-is
    x = a.rect.x;
    y = a.rect.y;
    width = a.rect.width;
    height = a.rect.height;
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'shape');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('kind', a.kind);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a shape's fill and/or stroke colour. Returns false for unknown colour names or stale id.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const entry = entryOf(doc, id);
  if (!isShapeEntry(entry)) return false;

  // Validate fill if provided
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  // Validate stroke if provided
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;

  // Check if anything actually changes
  let changed = false;
  if (s.fill !== undefined && entry.get('fill') !== s.fill) changed = true;
  if (s.stroke !== undefined && entry.get('stroke') !== s.stroke) changed = true;
  if (!changed) return false;

  doc.transact(() => {
    if (s.fill !== undefined) entry.set('fill', s.fill);
    if (s.stroke !== undefined) entry.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** Get the Y.Text label of a shape object, or undefined for a stale id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = entryOf(doc, id);
  if (!isShapeEntry(entry)) return undefined;
  const label = entry.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** Shape snapshot for rendering. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

/** Read a full ShapeSnapshot from a Y.Doc entry. */
export function readShapeSnapshot(id: string, entry: Y.Map<unknown>): ShapeSnap | null {
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const width = entry.get('width');
  const height = entry.get('height');
  const kind = entry.get('kind');
  const fill = entry.get('fill');
  const stroke = entry.get('stroke');
  const label = entry.get('label');

  if (!isFiniteNum(x) || !isFiniteNum(y)) return null;

  return {
    id,
    type: 'shape',
    x,
    y,
    z: isFiniteNum(z) ? z : 0,
    width: isFiniteNum(width) ? width : SHAPE_DEFAULT_SIZE_WORLD,
    height: isFiniteNum(height) ? height : SHAPE_DEFAULT_SIZE_WORLD,
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}
