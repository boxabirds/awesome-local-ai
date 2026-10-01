// The shape object: a rectangle, an ellipse or a diamond, drawn by dragging, with
// a centred label and two colours of its own.
//
// Shapes are board objects (design.md): the same `objects` map as sticky notes and
// text, the same transaction discipline - validation up front, one transaction per
// intent - so story 7's selection, moving, resizing and deleting, story 8's undo
// and story 3's sync apply without a line of new plumbing. A connector (the
// sibling module) points at a shape by its id and never by a cached position.
//
// What a shape is *not*: it is not a sticky note with a different skin. Its label
// is a second shared text (`label`, not `text`), so a peer reading a shape never
// has to know about notes, and a note's colour keys are never in here.

import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TYPE_SHAPE,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config.js';
import { LOCAL_ORIGIN } from '../board-model.js';
import type { ObjectSnapshot } from '../board-model.js';
import type { Point, Rect } from '../geometry.js';

export type { FillColor, ShapeKind, StrokeColor };

export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  width: number;
  height: number;
  fill: FillColor;
  stroke: StrokeColor;
  /** The label, read as a string; the text itself is a shared Y.Text. */
  label: string;
  createdAt: number;
  createdBy: string | null;
}

/** The design's name for the same snapshot. */
export type ShapeSnap = ShapeSnapshot;

/** How a shape is drawn, so the outline does not eat the label's space. */
export const SHAPE_STROKE_WIDTH = SHAPE_STROKE_WIDTH_WORLD;

/**
 * The word the Shape menu shows for each kind, in the menu's own order - which is
 * `SHAPE_KINDS`, the order the model lists them in, so the rail and the model can
 * never disagree about which kind is next to which.
 */
export const SHAPE_KIND_NAMES: Readonly<Record<ShapeKind, string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

const KINDS: readonly string[] = SHAPE_KINDS;

/** Anything in the document that is not a place is a bug or damage, never a guess. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasColor(names: Record<string, string>, value: unknown): boolean {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(names, value);
}

/** The largest z on the board, over every type, or 0 for an empty one.
 * Shapes draw among notes and text, so a new shape goes above all of them. */
function topZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const object of objects.values()) {
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/**
 * The rect a drag makes, or null when the drag was really a click.
 *
 * A drag that never reached SHAPE_MIN_SIZE_WORLD in *either* direction is a click
 * (PRD `shape.create_click`), and so is a drag of no size at all. The minimum is
 * the boundary that counts: exactly it is a shape, a hair under it is not.
 */
function draggedRect(rect: Rect | null | undefined): Rect | null {
  if (rect === null || rect === undefined) return null;
  if (
    typeof rect !== 'object' ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return null; // not a size at all: the caller rejects rather than invents one
  }
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) return null;
  return rect;
}

/**
 * The size a created shape gets, in world units: the dragged rect clamped to the
 * largest size the board allows; the standard size centred on the point when the
 * drag was a click; and, with Shift, the larger dragged dimension in both.
 */
function sizeFor(
  rect: Rect | null,
  at: Point,
  square: boolean | undefined,
): { x: number; y: number; width: number; height: number } {
  if (rect === null) {
    const half = Math.min(SHAPE_DEFAULT_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD) / 2;
    return { x: at.x - half, y: at.y - half, width: half * 2, height: half * 2 };
  }
  let width = Math.min(rect.width, MAX_OBJECT_SIZE_WORLD);
  let height = Math.min(rect.height, MAX_OBJECT_SIZE_WORLD);
  if (square) {
    // Shift: one side, the longer of the two, from the same corner.
    const side = Math.min(Math.max(rect.width, rect.height), MAX_OBJECT_SIZE_WORLD);
    width = side;
    height = side;
  }
  return { x: rect.x, y: rect.y, width, height };
}

/**
 * The box a create request would store - the same maths `createShape` does, asked
 * without a document, so the tool's preview is never a box the model disagrees
 * with. Null when the request would create nothing (a rect that is not a size).
 */
export function shapeRectOf(a: { rect: Rect | null; at: Point; square?: boolean }): Rect | null {
  if (
    a === null
    || typeof a !== 'object'
    || (a.rect !== null && a.rect !== undefined && draggedRect(a.rect) === null)
  ) {
    return null;
  }
  const size = sizeFor(draggedRect(a.rect ?? null), a.at, a.square);
  return { x: size.x, y: size.y, width: size.width, height: size.height };
}

/**
 * Draw a shape. `rect` is the dragged area (min corner and size); pass null for a
 * click, which drops a standard-size shape centred on `at`. With `square` (Shift
 * held during the drag) the larger dragged dimension becomes both.
 *
 * Validation comes first, outside any transaction: an unknown kind, a request that
 * is not one, or a rect that is not a size writes nothing and returns null.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (a === null || typeof a !== 'object') return null;
  if (!KINDS.includes(a.kind)) return null;
  const at = a.at;
  if (at === null || typeof at !== 'object') return null;
  const atX = finite(at.x);
  const atY = finite(at.y);
  if (atX === null || atY === null) return null;
  // a rect that is present but not a size is damage, not a click
  if (
    a.rect !== null
    && a.rect !== undefined
    && !(
      typeof a.rect === 'object'
      && Number.isFinite(a.rect.x)
      && Number.isFinite(a.rect.y)
      && Number.isFinite(a.rect.width)
      && Number.isFinite(a.rect.height)
    )
  ) {
    return null;
  }

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const size = sizeFor(draggedRect(a.rect), { x: atX, y: atY }, a.square);
  const id = (doc.clientID >>> 0).toString(16) + Math.random().toString(16).slice(2, 10);

  doc.transact(() => {
    const shape = new Y.Map<unknown>();
    shape.set('type', TYPE_SHAPE);
    shape.set('kind', a.kind);
    shape.set('x', size.x);
    shape.set('y', size.y);
    shape.set('width', size.width);
    shape.set('height', size.height);
    shape.set('z', topZ(objects) + 1);
    shape.set('createdAt', Date.now());
    if (typeof by === 'string') shape.set('createdBy', by);
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text());
    objects.set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Paint a shape: its fill, its outline, or both in one transaction.
 *
 * Both names are validated before anything is written, so a request carrying one
 * colour this build does not know applies neither half. A shape already wearing
 * the colour asked for is a success that changes nothing, and so writes nothing:
 * clicking the swatch that is already lit must not push an update at every peer or
 * give undo something to undo.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  if (typeof id !== 'string' || id === '') return false;
  if (style === null || typeof style !== 'object') return false;
  const wantsFill = style.fill !== undefined;
  const wantsStroke = style.stroke !== undefined;
  if (!wantsFill && !wantsStroke) return false;
  if (wantsFill && !hasColor(SHAPE_FILL_COLORS, style.fill)) return false;
  if (wantsStroke && !hasColor(SHAPE_STROKE_COLORS, style.stroke)) return false;

  const shape = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!(shape instanceof Y.Map) || shape.get('type') !== TYPE_SHAPE) return false;
  // already wearing what was asked for is a success that changes nothing, the way
  // colouring a note that is already that colour is: no transaction, nothing for
  // undo to undo, no update for a peer to receive
  const fillSame = !wantsFill || shape.get('fill') === style.fill;
  const strokeSame = !wantsStroke || shape.get('stroke') === style.stroke;
  if (fillSame && strokeSame) return true;

  let changed = false;
  doc.transact(() => {
    if (wantsFill && shape.get('fill') !== style.fill) {
      shape.set('fill', style.fill);
      changed = true;
    }
    if (wantsStroke && shape.get('stroke') !== style.stroke) {
      shape.set('stroke', style.stroke);
      changed = true;
    }
  }, LOCAL_ORIGIN);
  return changed;
}

/** The shape's label as the shared text typing writes into, or undefined. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const shape = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!(shape instanceof Y.Map) || shape.get('type') !== TYPE_SHAPE) return undefined;
  const label = shape.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/**
 * Read one object entry. A shape of a kind this build does not know is not drawn -
 * guessing a shape for it would draw the wrong thing and offer to re-colour it -
 * but a colour this build does not know is only a colour: the shape is drawn in the
 * default one, because hiding a peer's shape would lose the label inside it.
 */
export function readShape(id: string, object: Y.Map<unknown>): ShapeSnapshot | null {
  if (object.get('type') !== TYPE_SHAPE) return null;
  const x = finite(object.get('x'));
  const y = finite(object.get('y'));
  const width = finite(object.get('width'));
  const height = finite(object.get('height'));
  const z = finite(object.get('z'));
  const kind = object.get('kind');
  const label = object.get('label');
  if (x === null || y === null || width === null || height === null || z === null) return null;
  if (!KINDS.includes(kind as string)) return null;
  if (!(label instanceof Y.Text)) return null;

  const fill = object.get('fill');
  const stroke = object.get('stroke');
  const createdAt = finite(object.get('createdAt'));
  const createdBy = object.get('createdBy');
  return {
    id,
    type: TYPE_SHAPE,
    kind: kind as ShapeKind,
    x,
    y,
    width: Math.min(Math.max(width, 0), MAX_OBJECT_SIZE_WORLD),
    height: Math.min(Math.max(height, 0), MAX_OBJECT_SIZE_WORLD),
    z,
    fill: hasColor(SHAPE_FILL_COLORS, fill) ? (fill as FillColor) : DEFAULT_SHAPE_FILL,
    stroke: hasColor(SHAPE_STROKE_COLORS, stroke)
      ? (stroke as StrokeColor)
      : DEFAULT_SHAPE_STROKE,
    label: label.toString(),
    createdAt: createdAt ?? 0,
    createdBy: typeof createdBy === 'string' ? createdBy : null,
  };
}

/** Every shape on the board, in creation order. */
export function shapeSnapshots(doc: Y.Doc): readonly ShapeSnapshot[] {
  const shapes: ShapeSnapshot[] = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((object, id) => {
    if (!(object instanceof Y.Map)) return;
    const snap = readShape(id, object);
    if (snap !== null) shapes.push(snap);
  });
  return shapes;
}

/** One shape by id, or null when it is gone or unreadable. */
export function shapeSnapshot(doc: Y.Doc, id: string): ShapeSnapshot | null {
  if (typeof id !== 'string' || id === '') return null;
  const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return object instanceof Y.Map ? readShape(id, object) : null;
}
