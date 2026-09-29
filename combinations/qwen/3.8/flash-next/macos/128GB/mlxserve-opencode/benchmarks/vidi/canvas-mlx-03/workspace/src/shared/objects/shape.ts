// The shape object model (story 10 `shape.model`): the Yjs schema for a drawn shape
// and every mutation of it. Framework-free, so the client and any future worker code
// import it unchanged.
//
// Schema (one entry in the shared `objects` map):
//   objects/<id>: Y.Map {
//     type: 'shape', x, y, width, height, z, createdAt, createdBy,
//     kind: ShapeKind, fill: FillColor, stroke: StrokeColor, label: Y.Text
//   }
//
// Selection, move, resize, delete and undo all come from the generic board-model +
// registry (stories 7 and 8); this file only owns the fields a shape has that the
// generic machinery cannot infer. Like story 9's text model it imports from
// `board-model` and is never imported by it.

import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectSnapshots, type ObjectSnapshot } from '../board-model.ts';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../config.ts';
import type { Point, Rect } from '../geometry.ts';

const SHAPE_TYPE = 'shape';

/** The three kinds a user can draw. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A shape as the client renders it: the generic fields plus the shape's own. */
export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  /** The label as plain text; the editable `Y.Text` is `getShapeLabel`. */
  label: string;
  width: number;
  height: number;
  createdBy: string;
}

/**
 * What the Shape tool hands `createShape` when a drag (or a click) ends:
 * the drag rectangle in board units (null for a click), the point the drag
 * started at, and whether Shift was held.
 */
export interface ShapeCreateArgs {
  kind: ShapeKind;
  rect: Rect | null;
  at: Point;
  square?: boolean;
}

const FILLS = SHAPE_FILL_COLORS as Readonly<Record<string, string>>;
const STROKES = SHAPE_STROKE_COLORS as Readonly<Record<string, string>>;

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The highest z across every object, or 0 when none. */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let m = 0;
  for (const o of objects.values()) {
    const z = o.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > m) m = z;
  }
  return m;
}

function getShape(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const o = objects.get(id);
  if (o && o.get('type') === SHAPE_TYPE) return o;
  return undefined;
}

/** A usable positive size, or undefined when the stored value is unusable. */
function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FILLS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STROKES, value);
}

/** A colour name is rendered as its paint; an unknown name renders as nothing. */
export function shapeFillColor(name: unknown): string | undefined {
  return isFillColor(name) ? FILLS[name] : undefined;
}

export function shapeStrokeColor(name: unknown): string | undefined {
  return isStrokeColor(name) ? STROKES[name] : undefined;
}

/** The rectangle the drag actually describes, always with positive sides. */
function draggedRect(rect: Rect | null | undefined): Rect | null {
  if (!rect || !finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height))
    return null;
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/**
 * The box a new shape gets: the drag when it is at least `SHAPE_MIN_SIZE_WORLD` on
 * both sides, the standard size centred on `at` when the tool clicked or dragged
 * less than that (shape.create_click), and — when Shift was held — a square built on
 * the larger dragged side, anchored at the drag's origin (shape.constrain).
 */
export function shapeRect(a: {
  rect: Rect | null;
  at: Point;
  square?: boolean;
}): Rect | null {
  if (!finite(a.at?.x) || !finite(a.at?.y)) return null;
  const dragged = draggedRect(a.rect);
  if (!dragged || dragged.width < SHAPE_MIN_SIZE_WORLD || dragged.height < SHAPE_MIN_SIZE_WORLD) {
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    return {
      x: a.at.x - half,
      y: a.at.y - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (!a.square) return dragged;
  const side = Math.max(dragged.width, dragged.height);
  return { x: dragged.x, y: dragged.y, width: side, height: side };
}

/**
 * Create a shape and return its id, or null when the kind is unknown or the drag
 * rectangle / start point is not a real board point — in which case nothing is
 * written at all. On success exactly one `LOCAL_ORIGIN` transaction lands, so a
 * peer sees one update and story 8 sees one undo step.
 */
export function createShape(
  doc: Y.Doc,
  a: ShapeCreateArgs,
  by: string,
): string | null {
  if (!a || !isShapeKind(a.kind)) return null;
  if (!a.at || !finite(a.at.x) || !finite(a.at.y)) return null;
  if (a.rect != null && !(finite(a.rect.x) && finite(a.rect.y) && finite(a.rect.width) && finite(a.rect.height))) {
    return null;
  }
  const box = shapeRect(a);
  if (!box) return null;
  const id = crypto.randomUUID();
  const objects = objectsMap(doc);
  const z = maxZ(objects) + 1;
  const label = new Y.Text('');
  const o = new Y.Map<unknown>();
  doc.transact(() => {
    o.set('type', SHAPE_TYPE);
    o.set('x', box.x);
    o.set('y', box.y);
    o.set('width', box.width);
    o.set('height', box.height);
    o.set('kind', a.kind);
    o.set('fill', DEFAULT_SHAPE_FILL);
    o.set('stroke', DEFAULT_SHAPE_STROKE);
    o.set('label', label);
    o.set('z', z);
    o.set('createdAt', Date.now());
    o.set('createdBy', typeof by === 'string' ? by : '');
    objects.set(id, o);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Paint a shape (shape.style). Only the keys actually passed are written, and only
 * when every colour is a swatch name and the id still exists; otherwise nothing is
 * written and the call returns false. Label, size and position are never touched.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const fill = style?.fill;
  const stroke = style?.stroke;
  if (fill === undefined && stroke === undefined) return false;
  if (fill !== undefined && !isFillColor(fill)) return false;
  if (stroke !== undefined && !isStrokeColor(stroke)) return false;
  const o = getShape(objectsMap(doc), id);
  if (!o) return false;
  doc.transact(() => {
    if (fill !== undefined) o.set('fill', fill);
    if (stroke !== undefined) o.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shape's editable label, or undefined for a stale / non-shape id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const l = getShape(objectsMap(doc), id)?.get('label');
  return l instanceof Y.Text ? l : undefined;
}

/** Narrow a generic ObjectSnapshot (already read) to a ShapeSnapshot. */
export function asShapeSnapshot(o: ObjectSnapshot): ShapeSnapshot {
  return {
    ...o,
    type: 'shape',
    kind: isShapeKind(o.kind) ? o.kind : 'rect',
    fill: isFillColor(o.fill) ? o.fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(o.stroke) ? o.stroke : DEFAULT_SHAPE_STROKE,
    label: o.label ?? '',
    width: positive(o.width) ?? SHAPE_DEFAULT_SIZE_WORLD,
    height: positive(o.height) ?? SHAPE_DEFAULT_SIZE_WORLD,
    createdBy: o.createdBy ?? '',
  };
}

/** One shape's full snapshot, or undefined for a stale / non-shape id. */
export function shapeSnapshot(doc: Y.Doc, id: string): ShapeSnapshot | undefined {
  const found = objectSnapshots(doc).find((o) => o.id === id && o.type === SHAPE_TYPE);
  return found ? asShapeSnapshot(found) : undefined;
}

/** Every shape in the document, in stacking order. */
export function shapeSnapshots(doc: Y.Doc): readonly ShapeSnapshot[] {
  return shapesOf(objectSnapshots(doc));
}

/** The shapes in a snapshot list, in the same (stacking) order. */
export function shapesOf(objects: readonly ObjectSnapshot[]): ShapeSnapshot[] {
  const out: ShapeSnapshot[] = [];
  for (const o of objects) if (o.type === SHAPE_TYPE) out.push(asShapeSnapshot(o));
  return out;
}
