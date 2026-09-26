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
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

/**
 * Shape objects (story 10): rectangles, ellipses and diamonds with a centred
 * label and fill / outline colours. The geometry of a shape is its bounding box;
 * the kind decides how that box is drawn, so `ShapeObject` and `objectBounds`
 * can never disagree. Framework-free (no React / DOM) so the worker build of
 * `src/shared` compiles it.
 */

export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  /** The label text; the shared `Y.Text` itself comes from {@link getShapeLabel}. */
  label: string;
  createdBy: string;
  createdAt: number;
}

const KINDS: ReadonlySet<string> = new Set<string>(SHAPE_KINDS);
const FILLS: ReadonlySet<string> = new Set<string>(Object.keys(SHAPE_FILL_COLORS));
const STROKES: ReadonlySet<string> = new Set<string>(Object.keys(SHAPE_STROKE_COLORS));

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && KINDS.has(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && FILLS.has(value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && STROKES.has(value);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The rectangle a dragged shape lands on, or `null` when the drag does not count
 * as a drag: no rect at all (a click), or a side shorter than
 * `SHAPE_MIN_SIZE_WORLD` in either direction (`shape.create_click`).
 */
function draggedRect(rect: Rect | null): Rect | null {
  if (rect === null) return null;
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) return null;
  return rect;
}

/**
 * Square constraint (`shape.constrain`): both sides become the larger dragged
 * dimension, anchored at `from` — the corner the drag started from, which is the
 * dragged rect's corner nearest the origin of the drag.
 */
function squareRect(rect: Rect, from: Point): Rect {
  const side = Math.max(rect.width, rect.height);
  const growsRight = from.x <= rect.x + rect.width / 2;
  const growsDown = from.y <= rect.y + rect.height / 2;
  return {
    x: growsRight ? rect.x : rect.x + rect.width - side,
    y: growsDown ? rect.y : rect.y + rect.height - side,
    width: side,
    height: side,
  };
}

export interface CreateShapeArgs {
  kind: ShapeKind;
  /** Dragged area in world units, or null for a click. */
  rect: Rect | null;
  /** World point the drag / click started at. */
  at: Point;
  /** Shift held during the drag: force width === height. */
  square?: boolean;
}

/**
 * Create a shape (`shape.create_drag`, `shape.create_click`). A null rect, or a
 * drag smaller than `SHAPE_MIN_SIZE_WORLD` in either direction, drops a
 * standard `SHAPE_DEFAULT_SIZE_WORLD` shape centred on `at`. Returns the new id,
 * or null (no transaction) for an unknown kind or non-finite input.
 */
export function createShape(
  doc: Y.Doc,
  args: CreateShapeArgs,
  by: string,
): string | null {
  if (!isShapeKind(args.kind)) return null;
  if (!isFiniteNumber(args.at?.x) || !isFiniteNumber(args.at?.y)) return null;
  const rect = args.rect;
  if (
    rect !== null &&
    (!isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height))
  ) {
    return null;
  }

  const dragged = draggedRect(rect);
  let box: Rect;
  if (dragged === null) {
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    box = { x: args.at.x - half, y: args.at.y - half, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
  } else if (args.square === true) {
    box = squareRect(dragged, args.at);
  } else {
    box = dragged;
  }

  const objects = objectsMap(doc);
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', 'shape');
    map.set('kind', args.kind);
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('fill', DEFAULT_SHAPE_FILL);
    map.set('stroke', DEFAULT_SHAPE_STROKE);
    map.set('label', new Y.Text(''));
    map.set('z', maxZ(objects) + 1);
    map.set('createdBy', by);
    map.set('createdAt', createdAt);
    objects.set(id, map);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Apply a fill and/or outline colour (`shape.style`). Unknown colours and stale
 * ids return false without opening a transaction; nothing else about the shape
 * (label, size, position, z) is touched.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (obj === undefined || obj.get('type') !== 'shape') return false;
  if (style.fill === undefined && style.stroke === undefined) return false;
  if (style.fill !== undefined && !isFillColor(style.fill)) return false;
  if (style.stroke !== undefined && !isStrokeColor(style.stroke)) return false;

  doc.transact(() => {
    if (style.fill !== undefined) obj.set('fill', style.fill);
    if (style.stroke !== undefined) obj.set('stroke', style.stroke);
  }, LOCAL_ORIGIN);

  return true;
}

/** The shape's label as shared text for the editor, or undefined when absent. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'shape') return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** Parse a shape map into a snapshot, falling back to safe defaults per field. */
export function shapeSnapshotFrom(
  id: string,
  z: number,
  map: Y.Map<unknown>,
): ShapeSnapshot | null {
  const x = map.get('x');
  const y = map.get('y');
  const width = map.get('width');
  const height = map.get('height');
  const label = map.get('label');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (!(label instanceof Y.Text)) return null;
  const kind = map.get('kind');
  const fill = map.get('fill');
  const stroke = map.get('stroke');
  const createdBy = map.get('createdBy');
  const createdAt = map.get('createdAt');
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
    label: label.toString(),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}
