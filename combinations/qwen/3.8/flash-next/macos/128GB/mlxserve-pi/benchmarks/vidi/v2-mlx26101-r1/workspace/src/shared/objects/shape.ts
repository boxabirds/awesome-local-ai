// The shape model (story 10).
//
// A shape is a real object: it has a position, a size, a z-order and an author, and
// everybody in the room sees it at the same place. That is already enough to be
// correct with two people editing at once, and it is exactly what a mockup — which
// stores a picture of a drawing — cannot promise.
//
// Everything that could burn us is checked here, at the boundary where a number
// arrives from a pointer or from another person's machine: a non-finite coordinate, a
// drag that was really a click, a shape kind a client made up. The functions answer
// null or false and never break the document, because a client that merely noticed a
// broken value cannot repair it either — and a half-written shape is worse than no
// shape.
//
// Like story 9's text module, this file owns its fields and its own read of the
// `objects` map, and imports only LOCAL_ORIGIN and the shared types from board-model:
// the generic selection / move / resize / delete operations are reused untouched, so
// a shape behaves like every other object for free (shape.select). One
// `doc.transact(fn, LOCAL_ORIGIN)` per intent, so one undo takes a shape — or a whole
// style — away.

import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_KIND,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config';
import { LOCAL_ORIGIN } from '../board-model';
import { clampToLimit } from '../text-edit';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry/geometry';

export type { ShapeKind, FillColor, StrokeColor };

const OBJECTS = 'objects';

type ObjectMap = Y.Map<unknown>;
type Objects = Y.Map<Y.Map<unknown>>;

function objects(doc: Y.Doc): Objects {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

/** The id of a new object: the same rule sticky notes and text objects use. */
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

/** Return the object's Y.Map only when `id` is an existing shape. */
function getShapeMap(doc: Y.Doc, id: string): ObjectMap | undefined {
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'shape') return undefined;
  return map;
}

/** Highest `z` across every object (any type), so a new shape lands on top. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/**
 * A shape: a kind, a box it owns (unlike a text object, it is never measured from
 * its content) and a label. `label` is the Y.Text's content, materialised for
 * rendering; `getShapeLabel` returns the Y.Text itself for editing.
 */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  width: number;
  height: number;
  createdBy: string;
  label: string;
}

/**
 * What the Shape tool asks for. `rect` is the box the pointer dragged out, in world
 * units, or null when the pointer never travelled (a click). `at` is where the
 * pointer went down and is always required: it is the centre of the default box a
 * click gets. `square` is Shift held down (shape.square).
 */
export interface ShapeCreation {
  kind?: unknown;
  rect?: Rect | null;
  at: Point;
  square?: boolean;
}

/** A style picked from the Shape toolbar. Unknown values are refused, not clamped. */
export interface ShapeStylePatch {
  fill?: unknown;
  stroke?: unknown;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

/** The kind a stored object claims, or the default when a peer wrote nonsense. */
export function shapeKindOf(value: unknown): ShapeKind {
  return isShapeKind(value) ? value : DEFAULT_SHAPE_KIND;
}

export function shapeFillOf(value: unknown): FillColor {
  return isFillColor(value) ? value : DEFAULT_SHAPE_FILL;
}

export function shapeStrokeOf(value: unknown): StrokeColor {
  return isStrokeColor(value) ? value : DEFAULT_SHAPE_STROKE;
}

function isFiniteRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r &&
    isFiniteNumber(r.x) &&
    isFiniteNumber(r.y) &&
    isFiniteNumber(r.width) &&
    isFiniteNumber(r.height)
  );
}

/**
 * The box a shape takes, from whatever the pointer produced.
 *
 * A drag shorter than SHAPE_MIN_SIZE_WORLD in either direction was a click, not a
 * shape, and gets the default box centred where the pointer went down
 * (shape.create_click, TC-02). A drag of exactly SHAPE_MIN_SIZE_WORLD is kept as
 * drawn — that is the boundary, and it is the shape's own minimum size, so the next
 * resize cannot shrink it further. `square` forces both sides to the longer one,
 * anchored at the drag's origin: Shift narrows a guess into a square without moving
 * the corner the pointer started from (shape.square, TC-04).
 *
 * A rect with a non-finite field also comes out as the default box here, but
 * `createShape` refuses the request before it ever calls this: a box with a NaN in it
 * is not a click, and a shape nobody meant to draw is worse than no shape.
 */
export function shapeRect(
  rect: Rect | null | undefined,
  at: Point,
  square: boolean,
): Rect {
  if (!isFiniteRect(rect)) {
    return defaultRect(at);
  }
  if (rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD) {
    return defaultRect(at);
  }
  if (!square) return rect;
  const side = Math.max(rect.width, rect.height);
  return { x: rect.x, y: rect.y, width: side, height: side };
}

function defaultRect(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

/**
 * Create a shape, in exactly one transaction: every field lands together, so nobody
 * ever sees a shape without its size or its label, and one undo removes the whole
 * thing.
 *
 * Returns the new id, or null — having written nothing — when the request is not
 * sound: an unknown kind, a start point that is not two finite numbers, or an author
 * we cannot name. `by` is never guessed from the document: a shape nobody drew is an
 * accident nobody can explain.
 */
export function createShape(
  doc: Y.Doc,
  a: ShapeCreation,
  by: string,
): string | null {
  if (typeof by !== 'string' || by === '') return null;
  if (!isFiniteNumber(a?.at?.x) || !isFiniteNumber(a?.at?.y)) return null;
  const kind = a.kind === undefined ? DEFAULT_SHAPE_KIND : a.kind;
  if (!isShapeKind(kind)) return null;
  // A rect that arrived with something in it that is not a number is not a drag: it
  // is a pointer that lost its head. Refuse the request instead of drawing a box
  // nobody asked for (TC-06). An absent rect is the other case — a click — and gets
  // the default box.
  if (a.rect !== undefined && a.rect !== null && !isFiniteRect(a.rect)) return null;

  const rect = shapeRect(a.rect ?? null, { x: a.at.x, y: a.at.y }, a.square === true);
  const id = newId();

  doc.transact(() => {
    // The z-order is read *inside* the transaction: two people creating a shape at
    // the same moment are sequenced by Yjs, so they get two different layers rather
    // than both claiming the top one.
    const shape = new Y.Map<unknown>();
    shape.set('type', 'shape');
    shape.set('kind', kind);
    shape.set('x', rect.x);
    shape.set('y', rect.y);
    shape.set('width', rect.width);
    shape.set('height', rect.height);
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text(''));
    shape.set('z', maxZ(doc) + 1);
    shape.set('createdAt', Date.now());
    shape.set('createdBy', by);
    objects(doc).set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * The shape's label as a Y.Text, for the in-place editor — the same field a sticky
 * note and a text object keep their words in, so two people typing into one shape
 * merge instead of overwriting each other (shape.label). Undefined for a stale id or
 * an object that is not a shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const shape = getShapeMap(doc, id);
  if (!shape) return undefined;
  const label = shape.get('label');
  if (label instanceof Y.Text) return label;
  // A shape that predates the label field (or lost it): give it one, so its label is
  // always editable. The write is its own transaction; the editor is about to type.
  const created = new Y.Text('');
  shape.set('label', created);
  return created;
}

/**
 * Apply the fill and/or the outline chosen in the Shape toolbar in one transaction,
 * so a shape is never painted with half a new style (shape.style, TC-05).
 *
 * False — with no transaction, hence nothing on the wire — when the shape is gone
 * (someone else deleted it: the toolbar simply disappears), when no colour was
 * actually given, or when a value is not one of the palette's names. A colour that
 * left the palette is not silently kept: the toolbar offers a set of swatches, and a
 * value outside it means a client we do not agree with.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: ShapeStylePatch,
): boolean {
  const shape = getShapeMap(doc, id);
  if (!shape) return false;
  const writes: ['fill' | 'stroke', FillColor | StrokeColor][] = [];
  if (style.fill !== undefined) {
    if (!isFillColor(style.fill)) return false;
    writes.push(['fill', style.fill]);
  }
  if (style.stroke !== undefined) {
    if (!isStrokeColor(style.stroke)) return false;
    writes.push(['stroke', style.stroke]);
  }
  if (writes.length === 0) return false;
  doc.transact(() => {
    for (const [key, value] of writes) shape.set(key, value);
  }, LOCAL_ORIGIN);
  return true;
}

/** One shape, read from the document. Undefined when `id` is not a shape. */
export function shapeSnapshot(doc: Y.Doc, id: string): ShapeSnap | undefined {
  const shape = getShapeMap(doc, id);
  if (!shape) return undefined;
  return shapeFromMap(id, shape);
}

/**
 * Read a shape's stored fields. Its box is its own — written when it was created or
 * resized — so it is read straight out, with the same fallbacks `createShape` would
 * have produced if a peer stored something that is not a number. A shape is never
 * left unpainted because of a broken number.
 */
export function shapeFromMap(
  id: string,
  map: Y.Map<unknown>,
): ShapeSnap {
  const label = map.get('label');
  return {
    id,
    type: 'shape',
    kind: shapeKindOf(map.get('kind')),
    x: finiteOr(map.get('x'), 0),
    y: finiteOr(map.get('y'), 0),
    width: Math.max(0, finiteOr(map.get('width'), SHAPE_DEFAULT_SIZE_WORLD)),
    height: Math.max(0, finiteOr(map.get('height'), SHAPE_DEFAULT_SIZE_WORLD)),
    z: finiteOr(map.get('z'), 0),
    createdAt: finiteOr(map.get('createdAt'), 0),
    createdBy: typeof map.get('createdBy') === 'string' ? (map.get('createdBy') as string) : '',
    fill: shapeFillOf(map.get('fill')),
    stroke: shapeStrokeOf(map.get('stroke')),
    // The same limit the editor enforces while typing, applied on the way out so a
    // board written by a client that did not enforce it never paints more than the
    // label can hold (the rule story 9 chose for text).
    label: clampToLimit(
      label instanceof Y.Text ? label.toString() : '',
      SHAPE_LABEL_MAX_CHARS,
    ),
  };
}
