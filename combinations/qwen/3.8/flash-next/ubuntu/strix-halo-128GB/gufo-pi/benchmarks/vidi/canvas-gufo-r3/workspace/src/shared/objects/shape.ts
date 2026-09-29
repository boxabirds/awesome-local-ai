import * as Y from 'yjs';
import type { Point } from '@client/canvas/camera';
import type { Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  FillColor,
  ShapeKind,
  StrokeColor,
} from '../config';

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function getShapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map) || m.get('type') !== 'shape') return undefined;
  return m;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map) {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

/**
 * Create a shape.
 * - `rect` null, or smaller than SHAPE_MIN_SIZE_WORLD in either dimension:
 *   a SHAPE_DEFAULT_SIZE_WORLD square centred on `at` (click behaviour).
 * - `square`: both sides become the larger dragged dimension, anchored at the
 *   rect's origin corner (Shift constraint).
 * Returns the new id, or null on unknown kind / non-finite inputs (no transaction).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!a.at || !isFiniteNumber(a.at.x) || !isFiniteNumber(a.at.y)) return null;
  if (a.rect !== null) {
    if (
      !isFiniteNumber(a.rect.x) ||
      !isFiniteNumber(a.rect.y) ||
      !isFiniteNumber(a.rect.width) ||
      !isFiniteNumber(a.rect.height)
    ) {
      return null;
    }
  }

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (a.rect === null || a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
    // Click or tiny drag: standard size centred on the click point
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else if (a.square) {
    // Shift: square anchored at the drag origin
    const side = Math.max(a.rect.width, a.rect.height);
    x = a.rect.x;
    y = a.rect.y;
    width = side;
    height = side;
  } else {
    x = a.rect.x;
    y = a.rect.y;
    width = a.rect.width;
    height = a.rect.height;
  }

  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'shape');
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('kind', a.kind);
    m.set('fill', DEFAULT_SHAPE_FILL);
    m.set('stroke', DEFAULT_SHAPE_STROKE);
    m.set('label', new Y.Text());
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/** Apply fill and/or stroke. Validates names; stale id or unknown colour returns false with no transaction. */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const m = getShapeMap(doc, id);
  if (!m) return false;
  if (s.fill !== undefined && !isFillColor(s.fill)) return false;
  if (s.stroke !== undefined && !isStrokeColor(s.stroke)) return false;
  if (s.fill === undefined && s.stroke === undefined) return false;
  const changes: Array<[string, string]> = [];
  if (s.fill !== undefined && m.get('fill') !== s.fill) changes.push(['fill', s.fill]);
  if (s.stroke !== undefined && m.get('stroke') !== s.stroke) changes.push(['stroke', s.stroke]);
  if (changes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of changes) m.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/** Returns the label Y.Text for a shape, or undefined if not found. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getShapeMap(doc, id);
  if (!m) return undefined;
  const t = m.get('label');
  return t instanceof Y.Text ? t : undefined;
}

/** Snapshot all shape objects (sorted by z, id). */
export function snapshotShape(doc: Y.Doc): readonly ShapeSnap[] {
  const result: ShapeSnap[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'shape') return;
    const x = m.get('x');
    const y = m.get('y');
    const width = m.get('width');
    const height = m.get('height');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    const createdBy = m.get('createdBy');
    const kind = m.get('kind');
    const fill = m.get('fill');
    const stroke = m.get('stroke');
    const label = m.get('label');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    if (!isShapeKind(kind)) return;
    result.push({
      id,
      type: 'shape',
      x,
      y,
      width: isFiniteNumber(width) ? width : SHAPE_DEFAULT_SIZE_WORLD,
      height: isFiniteNumber(height) ? height : SHAPE_DEFAULT_SIZE_WORLD,
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      createdBy: typeof createdBy === 'string' ? createdBy : '',
      kind,
      fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
      stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
      label: label instanceof Y.Text ? label.toString() : '',
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
