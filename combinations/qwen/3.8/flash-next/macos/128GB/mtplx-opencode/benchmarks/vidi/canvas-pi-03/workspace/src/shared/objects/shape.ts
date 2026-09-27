// Shapes (story 10, contract `shape.model`).
//
// The schema and every mutation a client can make to a shape live here,
// framework-free and DOM-free, exactly like `board-model.ts`:
//
//   objects/<id>: Y.Map {
//     type: 'shape', x, y, width, height, z, createdAt, createdBy,
//     kind: ShapeKind,            // 'rect' | 'ellipse' | 'diamond'
//     fill: FillColor,            // a key of SHAPE_FILL_COLORS
//     stroke: StrokeColor,        // a key of SHAPE_STROKE_COLORS
//     label: Y.Text               // shared, edited through TextEditor
//   }
//
// Colour is stored as a KEY, not a hex string: the palette is a product setting
// (`SHAPE_FILL_COLORS`), and storing the key keeps the document small and the
// validation trivial — an unknown key is simply rejected.
//
// Selection, moving, resizing, deleting and undo stay generic: nothing
// shape-specific is added to those operations.

import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type ShapeKind,
  type FillColor,
  type StrokeColor,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

/** The object-map key holding the board's objects. */
const OBJECTS_KEY = 'objects';

export type { ShapeKind, FillColor, StrokeColor };

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

function shapeOf(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const obj = objects(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'shape') return null;
  return obj;
}

function topZ(doc: Y.Doc): number {
  let z = 0;
  objects(doc).forEach((obj) => {
    const value = obj.get('z');
    if (typeof value === 'number' && value > z) z = value;
  });
  return z;
}

export interface ShapeStyle {
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

/** True for a usable drawn rectangle: four finite numbers, non-zero size. */
function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

/** The footprint a drag creates, or null when the drag was too small to be a
 * shape (which is the same case as a click). */
function sizedRect(rect: Rect, square: boolean): Rect | null {
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) return null;
  if (!square) return { x: rect.x, y: rect.y, width, height };
  // Shift: the larger dragged dimension on both axes, anchored at the drag's
  // origin, so the shape never slides sideways while it is being squared.
  const side = Math.max(width, height);
  return { x: rect.x, y: rect.y, width: side, height: side };
}

/** A default shape, centred on the click point. */
function defaultRect(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

export interface CreateShapeArgs {
  /** The shape kind to draw; anything else creates nothing. */
  kind: string;
  /** The dragged rectangle in world space, or null for a plain click. */
  rect: Rect | null;
  /** The click point (used when `rect` is missing or too small). */
  at: Point;
  /** Shift was held: square the shape up. */
  square?: boolean;
}

/**
 * Draw a shape.
 *
 * A drag becomes a shape exactly covering the dragged area; a click — or a drag
 * smaller than `SHAPE_MIN_SIZE_WORLD` in either direction — becomes a
 * `SHAPE_DEFAULT_SIZE_WORLD` shape centred on `at`. An unknown kind, or a
 * non-finite rectangle or point, returns null and writes NOTHING (no
 * transaction, so no update and no undo step).
 */
export function createShape(doc: Y.Doc, a: CreateShapeArgs, by: string): string | null {
  if (!a) return null;
  if (typeof a.kind !== 'string' || !(SHAPE_KINDS as readonly string[]).includes(a.kind)) return null;
  if (!a.at || !Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null;

  let footprint: Rect;
  if (a.rect === null) {
    footprint = defaultRect(a.at);
  } else {
    if (!isFiniteRect(a.rect)) return null;
    const sized = sizedRect(a.rect, a.square === true);
    footprint = sized ?? defaultRect(a.at);
  }

  const id = crypto.randomUUID();
  const label = new Y.Text();
  const record = new Y.Map<unknown>();
  const map = objects(doc);
  const z = topZ(doc) + 1;
  doc.transact(() => {
    record.set('type', 'shape');
    record.set('x', footprint.x);
    record.set('y', footprint.y);
    record.set('width', footprint.width);
    record.set('height', footprint.height);
    record.set('kind', a.kind);
    record.set('fill', DEFAULT_SHAPE_FILL);
    record.set('stroke', DEFAULT_SHAPE_STROKE);
    record.set('label', label);
    record.set('z', z);
    record.set('createdAt', Date.now());
    record.set('createdBy', by);
    map.set(id, record);
  }, LOCAL_ORIGIN);
  return id;
}

/** The shape's label Y.Text, or undefined for a stale or non-shape id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  return shapeOf(doc, id)?.get('label') as Y.Text | undefined;
}

/** Read a shape's style (used by the renderer and the toolbar). */
export function getShapeStyle(doc: Y.Doc, id: string): ShapeStyle | null {
  const obj = shapeOf(doc, id);
  if (obj === null) return null;
  const kind = obj.get('kind') as ShapeKind;
  const fill = obj.get('fill') as FillColor;
  const stroke = obj.get('stroke') as StrokeColor;
  const label = obj.get('label') as Y.Text | undefined;
  return {
    kind: (SHAPE_KINDS as readonly string[]).includes(kind) ? kind : 'rect',
    fill: Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, stroke)
      ? stroke
      : DEFAULT_SHAPE_STROKE,
    label: label ? label.toString() : '',
  };
}

/**
 * Change a shape's fill and/or outline.
 *
 * Only the colour keys are touched — position, size, kind and label are never
 * written, so recolouring cannot move or resize anything. An unknown colour or
 * a stale id returns false with no transaction; so does a colour the shape
 * already has (no redundant updates).
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  if (!s) return false;
  const obj = shapeOf(doc, id);
  if (obj === null) return false;
  const writes: [string, string][] = [];
  if (s.fill !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, s.fill)) return false;
    if (obj.get('fill') !== s.fill) writes.push(['fill', s.fill]);
  }
  if (s.stroke !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, s.stroke)) return false;
    if (obj.get('stroke') !== s.stroke) writes.push(['stroke', s.stroke]);
  }
  if (writes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of writes) obj.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/** The label limit (kept here so the editor and the model agree on one number). */
export const SHAPE_TEXT_LIMIT = SHAPE_LABEL_MAX_CHARS;
