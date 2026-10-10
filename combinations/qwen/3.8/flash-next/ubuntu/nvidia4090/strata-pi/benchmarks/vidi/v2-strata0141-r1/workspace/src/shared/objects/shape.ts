import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  registerSelectableType,
  registerSnapshotReader,
  type ObjectSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
} from '../config';
import { clampToLimit } from '../text-edit';

/**
 * The shape model (anchor `shape.kind`, `shape.size`, `shape.colours`,
 * `shape.label`).
 *
 * Schema (`objects/<id>`):
 *
 * ```
 * { type: 'shape', x, y, width, height, z, createdAt, createdBy,
 *   kind: 'rect' | 'ellipse' | 'diamond',
 *   fill: ShapeFillColor, stroke: ShapeStrokeColor, label: Y.Text }
 * ```
 *
 * `width` and `height` are always stored: a shape's box is what a person dragged
 * out, and story 7's resize writes it again (`sel.resize`). The label is a
 * `Y.Text`, so two people typing into the same shape's label merge the way note
 * and text content merges.
 *
 * Nothing here throws for user-driven input: an unknown kind, a non-finite
 * rectangle, an unknown colour name or a no-op is refused before a transaction
 * opens, so no `update` event is emitted (TC-05, TC-06).
 */

export interface ShapeSnapshot extends ObjectSnapshot {
  readonly type: 'shape';
  /** Always present for a shape: the box is the drag, or the default (`shape.size`). */
  readonly width: number;
  readonly height: number;
  readonly kind: ShapeKind;
  readonly fill: ShapeFillColor;
  readonly stroke: ShapeStrokeColor;
  readonly label: string;
  readonly createdBy: string;
}

export interface CreateShapeArgs {
  readonly kind: ShapeKind;
  /**
   * The dragged rectangle, already normalized (`normalizeRect`), or null when
   * the pointer never left the click - a click is a shape, not a no-op.
   */
  readonly rect: Rect | null;
  /**
   * The drag origin, or the click point. The default box is centred on it, and a
   * Shift-constrained box keeps it as the corner the drag started from.
   */
  readonly at: Point;
  /** Shift held while dragging (`shape.size`): both sides take the larger dimension. */
  readonly square?: boolean;
}

export interface ShapeStylePatch {
  readonly fill?: ShapeFillColor;
  readonly stroke?: ShapeStrokeColor;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isShapeKind = (value: unknown): value is ShapeKind =>
  value === 'rect' || value === 'ellipse' || value === 'diamond';

const isFillName = (value: unknown): value is ShapeFillColor =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);

const isStrokeName = (value: unknown): value is ShapeStrokeColor =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const asObjectMap = (value: unknown): Y.Map<unknown> | undefined =>
  value instanceof Y.Map ? value : undefined;

/** The stored entry for `id`, when it is a shape. */
const shapeEntry = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => {
  if (typeof id !== 'string' || id === '') {
    return undefined;
  }
  const entry = asObjectMap(objectsOf(doc).get(id));
  if (!entry || entry.get('type') !== 'shape') {
    return undefined;
  }
  return entry;
};

/** UUIDs, so two people drawing at the same moment cannot collide (story 3). */
function randomId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(16);
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** Highest `z` in the document (0 when it holds nothing). */
function maxZ(objects: Y.Map<unknown>): number {
  let highest = 0;
  objects.forEach((value) => {
    const z = asObjectMap(value)?.get('z');
    if (isFiniteNumber(z) && z > highest) {
      highest = z;
    }
  });
  return highest;
}

const isUsableSize = (width: unknown, height: unknown): boolean =>
  isFiniteNumber(width) && isFiniteNumber(height) && width > 0 && height > 0;

/**
 * The box a shape actually gets (`shape.size`).
 *
 * - no rectangle, or a rectangle with a side under SHAPE_MIN_SIZE_WORLD: the
 *   default square, **centred on the click** - a click is a placement, so the
 *   point that was clicked ends up in the middle of the shape;
 * - a rectangle big enough: kept exactly as dragged;
 * - Shift (`square`): both sides take the larger dimension, anchored on the
 *   corner the drag started from, so a square never slides out from under the
 *   pointer whatever direction the drag went.
 */
function boxFor(args: CreateShapeArgs): Rect | null {
  const { rect, at, square } = args;
  if (rect === null || rect === undefined) {
    return {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (!isUsableSize(rect.width, rect.height)) {
    return null;
  }
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    return {
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (!square) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const side = Math.max(rect.width, rect.height);
  // `at` is one corner of the normalized rectangle: the side it sits on is the
  // side the square grows from.
  const x = at.x > rect.x ? at.x - side : rect.x;
  const y = at.y > rect.y ? at.y - side : rect.y;
  return { x, y, width: side, height: side };
}

/**
 * Read one stored object as a shape snapshot (`shape.model`).
 *
 * Registered with the board model, so `objectSnapshots` - and with it selection,
 * marquee, move, resize and delete - knows how to read a shape without any
 * shape-specific interaction code (`sel.all_types`).
 */
export function shapeFrom(id: string, value: unknown): ShapeSnapshot | undefined {
  const entry = asObjectMap(value);
  if (!entry || entry.get('type') !== 'shape') {
    return undefined;
  }
  const kind = entry.get('kind');
  if (!isShapeKind(kind)) {
    return undefined; // a half-written or unknown shape is not renderable
  }
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const width = entry.get('width');
  const height = entry.get('height');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined;
  }
  const fill = entry.get('fill');
  const stroke = entry.get('stroke');
  const label = entry.get('label');
  const createdBy = entry.get('createdBy');
  const size = isUsableSize(width, height)
    ? { width: width as number, height: height as number }
    : { width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
  return Object.freeze({
    id,
    type: 'shape' as const,
    x,
    y,
    width: size.width,
    height: size.height,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    kind,
    fill: isFillName(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeName(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  });
}

registerSelectableType('shape');
registerSnapshotReader('shape', shapeFrom);

/** One stored shape, read as a snapshot - for rendering and for the toolbar. */
export function readShapeSnapshot(doc: Y.Doc, id: string): ShapeSnapshot | undefined {
  return shapeFrom(id, objectsOf(doc).get(id));
}

/**
 * Create a shape (`shape.create`).
 *
 * One transaction: `type:'shape'`, x, y, width, height, z = maxZ + 1, createdAt,
 * createdBy, kind, fill, stroke, `label: new Y.Text('')`.
 *
 * Returns the new id, or `null` when the kind is unknown, the click is not a
 * real position or the dragged rectangle is not a real box - in which case no
 * transaction is opened and nothing is created (TC-06).
 */
export function createShape(
  doc: Y.Doc,
  args: CreateShapeArgs,
  createdBy: string,
): string | null {
  if (!args || !isShapeKind(args.kind)) {
    return null;
  }
  const at = args.at;
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) {
    return null;
  }
  if (args.rect !== null && args.rect !== undefined) {
    const rect = args.rect;
    if (
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height)
    ) {
      return null;
    }
  }
  if (typeof createdBy !== 'string') {
    return null;
  }
  const box = boxFor(args);
  if (box === null) {
    return null;
  }
  const id = randomId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', 'shape');
    object.set('kind', args.kind);
    object.set('x', box.x);
    object.set('y', box.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('fill', DEFAULT_SHAPE_FILL);
    object.set('stroke', DEFAULT_SHAPE_STROKE);
    object.set('label', new Y.Text(''));
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', createdBy);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a shape's fill or outline (`shape.colours`).
 *
 * Colours are **named keys** of SHAPE_FILL_COLORS / SHAPE_STROKE_COLORS, never a
 * raw CSS string, so every client resolves the same value. A stale id, an unknown
 * name, or a patch that changes nothing is refused before the transaction opens:
 * zero `update` events (TC-05).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  patch: ShapeStylePatch,
): boolean {
  const entry = shapeEntry(doc, id);
  if (!entry) {
    return false;
  }
  if (!patch) {
    return false;
  }
  const writes: { key: 'fill' | 'stroke'; value: string }[] = [];
  if (patch.fill !== undefined) {
    if (!isFillName(patch.fill)) {
      return false;
    }
    if (entry.get('fill') !== patch.fill) {
      writes.push({ key: 'fill', value: patch.fill });
    }
  }
  if (patch.stroke !== undefined) {
    if (!isStrokeName(patch.stroke)) {
      return false;
    }
    if (entry.get('stroke') !== patch.stroke) {
      writes.push({ key: 'stroke', value: patch.stroke });
    }
  }
  if (writes.length === 0) {
    return false; // nothing to change: no transaction, no update event
  }
  doc.transact(() => {
    for (const write of writes) {
      entry.set(write.key, write.value);
    }
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's label as a shared `Y.Text`, or `undefined` for a stale id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = shapeEntry(doc, id);
  if (!entry) {
    return undefined;
  }
  const label = entry.get('label');
  if (label instanceof Y.Text) {
    return label;
  }
  const created = new Y.Text('');
  // A shape written by an older or half-written entry gets its label back, so
  // the editor always has a shared Y.Text to type into.
  doc.transact(() => entry.set('label', created), LOCAL_ORIGIN);
  return created;
}

/** The label limit (`shape.label`): clamped by the editor before it is written. */
export const SHAPE_LABEL_LIMIT = SHAPE_LABEL_MAX_CHARS;

export function clampShapeLabel(next: string): string {
  return clampToLimit(next, SHAPE_LABEL_MAX_CHARS);
}

/** The smallest a shape may be resized to, shared with the registry. */
export const SHAPE_MIN_SIZE = SHAPE_MIN_SIZE_WORLD;
