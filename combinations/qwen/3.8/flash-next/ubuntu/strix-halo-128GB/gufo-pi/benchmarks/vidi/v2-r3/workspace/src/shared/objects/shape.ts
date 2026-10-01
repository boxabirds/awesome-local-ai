/**
 * Shape object model (story 10).
 * Schema helpers: create, set style, get label.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getObjectsMap } from '../board-model';
import type { Point, Rect } from '../geometry';
import type { ShapeKind, FillColor, StrokeColor } from '../config';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
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

function isValidKind(k: unknown): k is ShapeKind {
  return typeof k === 'string' && (SHAPE_KINDS as readonly string[]).includes(k);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Create a shape. Returns the new id, or null on invalid input.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!isValidKind(a.kind)) return null;

  // Validate at point
  if (!a.at || !isFiniteNumber(a.at.x) || !isFiniteNumber(a.at.y)) return null;

  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: default size centred on `at`
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    // Validate rect finiteness
    if (!isFiniteNumber(a.rect.x) || !isFiniteNumber(a.rect.y) ||
        !isFiniteNumber(a.rect.width) || !isFiniteNumber(a.rect.height)) {
      return null;
    }

    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      // Too small: use default size centred at `at`
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else if (a.square) {
      // Shift constraint: use larger dimension for both, anchored at drag origin
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
  }

  const objects = getObjectsMap(doc);
  const id = crypto.randomUUID();

  // Compute z = maxZ + 1
  let z = 0;
  for (const m of objects.values()) {
    const zv = m.get('z');
    if (typeof zv === 'number' && zv > z) z = zv;
  }
  z += 1;

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'shape');
    m.set('kind', a.kind);
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('fill', DEFAULT_SHAPE_FILL);
    m.set('stroke', DEFAULT_SHAPE_STROKE);
    m.set('label', new Y.Text());
    m.set('z', z);
    m.set('createdAt', Date.now());
    m.set('createdBy', by);
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Update fill and/or stroke of a shape. Returns false on stale id or unknown colour.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  if (typeof id !== 'string' || id === '') return false;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'shape') return false;

  // Validate colours before writing anything
  if (s.fill !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, s.fill)) return false;
  }
  if (s.stroke !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, s.stroke)) return false;
  }

  // Check if anything actually changes
  const curFill = m.get('fill');
  const curStroke = m.get('stroke');
  const fillChanged = s.fill !== undefined && s.fill !== curFill;
  const strokeChanged = s.stroke !== undefined && s.stroke !== curStroke;
  if (!fillChanged && !strokeChanged) return false;

  doc.transact(() => {
    if (s.fill !== undefined && s.fill !== curFill) m.set('fill', s.fill);
    if (s.stroke !== undefined && s.stroke !== curStroke) m.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Returns the Y.Text for the shape's label, for collaborative editing.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const objects = getObjectsMap(doc);
  const m = objects.get(id);
  if (!m || m.get('type') !== 'shape') return undefined;
  const label = m.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/**
 * Read a shape from a Y.Map into a ShapeSnap (used by snapshot()).
 */
export function readShape(id: string, m: Y.Map<unknown>): ShapeSnap | null {
  if (m.get('type') !== 'shape') return null;
  const x = m.get('x');
  const y = m.get('y');
  const width = m.get('width');
  const height = m.get('height');
  const z = m.get('z');
  const kind = m.get('kind');
  const fill = m.get('fill');
  const stroke = m.get('stroke');
  const label = m.get('label');
  const createdAt = m.get('createdAt');
  const createdBy = m.get('createdBy');

  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (!isFiniteNumber(z)) return null;
  if (!isValidKind(kind)) return null;

  return {
    id,
    type: 'shape',
    x,
    y,
    width,
    height,
    z,
    kind,
    fill: (typeof fill === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, fill)) ? fill as FillColor : DEFAULT_SHAPE_FILL,
    stroke: (typeof stroke === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, stroke)) ? stroke as StrokeColor : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : typeof label === 'string' ? label : '',
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  };
}
