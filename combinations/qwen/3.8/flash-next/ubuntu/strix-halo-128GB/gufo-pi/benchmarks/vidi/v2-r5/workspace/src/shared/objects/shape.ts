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
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';

/**
 * Shape object model: schema helpers for creating and styling shapes.
 *
 * Schema per shape:
 *   objects/<id>: Y.Map {
 *     type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *     kind: ShapeKind,
 *     fill: FillColor,
 *     stroke: StrokeColor,
 *     label: Y.Text
 *   }
 */

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const SHAPE_KIND_SET = new Set<string>(SHAPE_KINDS);
const FILL_KEYS = new Set<string>(Object.keys(SHAPE_FILL_COLORS));
const STROKE_KEYS = new Set<string>(Object.keys(SHAPE_STROKE_COLORS));

export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

/** Largest `z` currently in use across all objects (0 for an empty board). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const value of objectsMap(doc).values()) {
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > top) top = z;
  }
  return top;
}

/**
 * Create a shape. If `rect` is null or too small, creates a default-size shape centred on `at`.
 * If `square` is true, both dimensions use the larger of the two (anchored at drag origin).
 * Returns new id or null on invalid inputs (no transaction).
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!SHAPE_KIND_SET.has(a.kind)) return null;
  // Validate `at` point
  if (!isFiniteNumber(a.at?.x) || !isFiniteNumber(a.at?.y)) return null;

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
        !isFiniteNumber(a.rect.width) || !isFiniteNumber(a.rect.height)) return null;

    if (a.rect.width < SHAPE_MIN_SIZE_WORLD || a.rect.height < SHAPE_MIN_SIZE_WORLD) {
      // Too small: treated as a click
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    } else if (a.square) {
      // Shift: square using the larger dimension, anchored at drag origin
      const side = Math.max(a.rect.width, a.rect.height);
      width = side;
      height = side;
      x = a.rect.x;
      y = a.rect.y;
    } else {
      x = a.rect.x;
      y = a.rect.y;
      width = a.rect.width;
      height = a.rect.height;
    }
  }

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'shape');
    map.set('x', x);
    map.set('y', y);
    map.set('width', width);
    map.set('height', height);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', by);
    map.set('kind', a.kind);
    map.set('fill', DEFAULT_SHAPE_FILL);
    map.set('stroke', DEFAULT_SHAPE_STROKE);
    map.set('label', new Y.Text(''));
    objectsMap(doc).set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change a shape's fill or stroke colour. Validates colour keys against palettes.
 * Returns false for stale id, non-shape type, or unknown colour (no transaction).
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  // Validate colours before opening transaction
  if (s.fill !== undefined && !FILL_KEYS.has(s.fill)) return false;
  if (s.stroke !== undefined && !STROKE_KEYS.has(s.stroke)) return false;

  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'shape') return false;

  doc.transact(() => {
    if (s.fill !== undefined) map.set('fill', s.fill);
    if (s.stroke !== undefined) map.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** Get the shared Y.Text label of a shape, or undefined for stale id / wrong type. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'shape') return undefined;
  const text = map.get('label');
  return text instanceof Y.Text ? text : undefined;
}

/** Read a shape snapshot from the doc for a given id. */
export function readShapeSnapshot(doc: Y.Doc, id: string): ShapeSnap | undefined {
  const map = objectsMap(doc).get(id);
  if (!map || map.get('type') !== 'shape') return undefined;
  const label = map.get('label');
  const kind = map.get('kind');
  const fill = map.get('fill');
  const stroke = map.get('stroke');
  return {
    id,
    type: 'shape',
    x: typeof map.get('x') === 'number' ? (map.get('x') as number) : 0,
    y: typeof map.get('y') === 'number' ? (map.get('y') as number) : 0,
    width: typeof map.get('width') === 'number' ? (map.get('width') as number) : SHAPE_DEFAULT_SIZE_WORLD,
    height: typeof map.get('height') === 'number' ? (map.get('height') as number) : SHAPE_DEFAULT_SIZE_WORLD,
    z: typeof map.get('z') === 'number' ? (map.get('z') as number) : 0,
    kind: typeof kind === 'string' && SHAPE_KIND_SET.has(kind) ? (kind as ShapeKind) : 'rect',
    fill: typeof fill === 'string' && FILL_KEYS.has(fill) ? (fill as FillColor) : DEFAULT_SHAPE_FILL,
    stroke: typeof stroke === 'string' && STROKE_KEYS.has(stroke) ? (stroke as StrokeColor) : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
}
