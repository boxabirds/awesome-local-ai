/**
 * The `shape` object type (story 10, design anchor `shape.model`).
 *
 * A shape is a rectangle, an ellipse or a diamond with a centred label and two
 * colours: an ordinary board object - the same `objects` map, the same
 * `x`/`y`/`width`/`height`/`z`/`createdAt` fields as a sticky note or a piece of
 * text - plus five fields of its own:
 *
 *   kind:      'rect' | 'ellipse' | 'diamond'  what was drawn (shape.create_drag)
 *   fill:      FillColor                       one of the seven fill names
 *   stroke:    StrokeColor                     one of the six outline names
 *   label:     Y.Text                          the words inside it (shape.label)
 *   createdBy: string                          who made it
 *
 * Like every model function here, each mutation is exactly one
 * `doc.transact(fn, LOCAL_ORIGIN)`; every rejection (unknown kind, non-finite
 * rectangle, unknown colour, stale id) returns `null`/`false` **before** a
 * transaction is opened, so a mistake costs no sync traffic and nothing for
 * story 8's undo to undo. Nothing here throws for user-driven input.
 *
 * The label is a `Y.Text` for the reason story 9's text is one: two people can
 * type in the same label at once and the words interleave instead of one of them
 * winning. It is never measured: a shape's box is what the drag said it was, and
 * words that do not fit are clipped by the component, so typing cannot move the
 * board around the person who is drawing.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, OBJECT_FIELDS, objectSnapshot, type ObjectSnapshot, type Point, type Rect } from '../board-model.js';
// See the note in `connector.ts`: type modules register through the registry
// module directly, because board-model imports `connector.ts` and a re-export is
// not filled in until the module it is re-exported from has finished loading.
import {
  registerBoardObjectType,
  registerDefaultObjectSize,
  registerObjectSnapshotReader,
} from '../object-registry.js';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  isFillColor,
  isShapeKind,
  isStrokeColor,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config.js';

/** The object type name, as stored in `objects.<id>.type`. */
export const SHAPE_TYPE = 'shape';

/**
 * Which of the three kinds a shape can be. The names live in `config.ts` beside the
 * palette and the default size, and are repeated here because a shape's own type names
 * one: code that reads a `ShapeSnap` and switches on `kind` should not have to go
 * looking in a third place for the values it can hold.
 */
export type { ShapeKind };

/** An immutable view of one shape, as rendered by the client. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  /** Which of the three kinds was drawn; it never changes afterwards. */
  kind: ShapeKind;
  /** The fill, by palette name (`SHAPE_FILL_COLORS`), `none` for no fill. */
  fill: FillColor;
  /** The outline, by palette name (`SHAPE_STROKE_COLORS`). */
  stroke: StrokeColor;
  /** The label, for drawing. Editing goes through {@link getShapeLabel}. */
  label: string;
  /** Who made it; absent for an object created by a client that had no name. */
  createdBy?: string;
}

/**
 * The type is known to the board model as soon as this module is loaded - and the
 * client registry's own registration is idempotent.
 */
registerBoardObjectType(SHAPE_TYPE);
registerObjectSnapshotReader(SHAPE_TYPE, readShapeSnapshot);
// A shape always carries its own box; this is the size it means when it lost it.
registerDefaultObjectSize(SHAPE_TYPE, SHAPE_DEFAULT_SIZE_WORLD);

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;

/** The field a shape's label text lives under. */
const LABEL_FIELD = 'label';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFinitePoint = (value: Point | null | undefined): value is Point =>
  value !== null && value !== undefined && isFiniteNumber(value.x) && isFiniteNumber(value.y);

/** A rectangle a caller may be trusted with: four finite numbers. */
function asRect(value: Rect): Rect | null {
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

/** The object map of `id`, when it exists and is a shape. */
function readShapeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const map = objectsOf(doc).get(id);
  if (!(map instanceof Y.Map)) return undefined;
  if (map.get(OBJECT_FIELDS.type) !== SHAPE_TYPE) return undefined;
  return map;
}

/** Highest z in the document (0 when there are no objects). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((map) => {
    if (!(map instanceof Y.Map)) return;
    const z = map.get(OBJECT_FIELDS.z);
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/** A unique object id; the same helper the other object types use. */
function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Read one object map into a {@link ShapeSnap}, or skip it. */
function readShapeSnapshot(id: string, map: Y.Map<unknown>): ShapeSnap | undefined {
  if (map.get(OBJECT_FIELDS.type) !== SHAPE_TYPE) return undefined;

  const x = map.get(OBJECT_FIELDS.x);
  const y = map.get(OBJECT_FIELDS.y);
  const z = map.get(OBJECT_FIELDS.z);
  // A malformed object is skipped rather than rendered, exactly as a sticky note
  // or a piece of text is.
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;

  const kind = map.get('kind');
  if (!isShapeKind(kind)) return undefined;
  const width = map.get(OBJECT_FIELDS.width);
  const height = map.get(OBJECT_FIELDS.height);
  const createdAt = map.get(OBJECT_FIELDS.createdAt);
  const createdBy = map.get('createdBy');
  const label = map.get(LABEL_FIELD);

  const snapshot: ShapeSnap = {
    id,
    type: 'shape',
    x,
    y,
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    kind,
    // A colour this version does not know reads as the default rather than
    // vanishing the shape: the shape was asked for, and its words are still there.
    fill: isFillColor(map.get('fill')) ? (map.get('fill') as FillColor) : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(map.get('stroke')) ? (map.get('stroke') as StrokeColor) : DEFAULT_SHAPE_STROKE,
    label: label instanceof Y.Text ? label.toString() : '',
  };
  // A shape always carries a box; one that lost it is left without a size so
  // `objectBounds` supplies the fallback instead.
  if (isFiniteNumber(width) && width > 0) snapshot.width = width;
  if (isFiniteNumber(height) && height > 0) snapshot.height = height;
  if (typeof createdBy === 'string' && createdBy.length > 0) snapshot.createdBy = createdBy;
  return snapshot;
}

/* ------------------------------------------------------------------- create */

/**
 * Create a shape (`shape.create_click`, `shape.create_drag`).
 *
 * `rect` is the rectangle the pointer dragged, already normalised to a positive
 * width and height by whoever measured it; `at` is the point the pointer went
 * down. A `rect` of `null` - a click - and a rectangle under
 * {@link SHAPE_MIN_SIZE_WORLD} in *either* direction both become a
 * {@link SHAPE_DEFAULT_SIZE_WORLD} square centred on `at`, so a tired hand that
 * taps the board gets a shape rather than a hairline. `square` (the Shift key at
 * the moment of release) makes both sides the larger of the two, anchored at the
 * corner the drag started from, which is the one thing about the drag that person
 * was certainly not trying to change.
 *
 * The shape goes on top of everything, at the default colours, with an empty
 * label. Returns the new id, or `null` for a kind this build does not know or a
 * rectangle / point that is not made of finite numbers - in which case nothing
 * was written at all.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!isShapeKind(a.kind)) return null;
  if (!isFinitePoint(a.at)) return null;

  let box: Rect | null;
  if (a.rect == null) {
    box = null;
  } else {
    const dragged = asRect(a.rect);
    // A rectangle that is not four numbers is not a drag that went wrong, it is a
    // caller that cannot say where it dragged: refused, rather than quietly
    // answered with a shape somewhere else on the board.
    if (dragged === null) return null;
    // A rectangle under the minimum in either direction is a click that wobbled.
    box =
      dragged.width < SHAPE_MIN_SIZE_WORLD || dragged.height < SHAPE_MIN_SIZE_WORLD
        ? null
        : dragged;
  }
  if (box === null) {
    box = {
      x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  } else if (a.square === true) {
    const side = Math.max(box.width, box.height);
    box = { x: box.x, y: box.y, width: side, height: side };
  }

  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const id = nextId();
  const creator = typeof by === 'string' && by.trim().length > 0 ? by : null;

  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(OBJECT_FIELDS.type, SHAPE_TYPE);
    map.set(OBJECT_FIELDS.x, box.x);
    map.set(OBJECT_FIELDS.y, box.y);
    map.set(OBJECT_FIELDS.width, box.width);
    map.set(OBJECT_FIELDS.height, box.height);
    map.set(OBJECT_FIELDS.z, z);
    map.set(OBJECT_FIELDS.createdAt, Date.now());
    map.set(LABEL_FIELD, new Y.Text());
    map.set('kind', a.kind);
    map.set('fill', DEFAULT_SHAPE_FILL);
    map.set('stroke', DEFAULT_SHAPE_STROKE);
    if (creator !== null) map.set('createdBy', creator);
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/* ------------------------------------------------------------------- the label */

/**
 * The shared label of a shape, for the text editor (`applyTextDiff` writes the
 * minimal change into it, and story 8's undo scopes to it). `undefined` when
 * there is no such shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = readShapeMap(doc, id)?.get(LABEL_FIELD);
  return text instanceof Y.Text ? text : undefined;
}

/* ------------------------------------------------------------------- the style */

/**
 * Restyle a shape (`shape.style`): `fill` and `stroke` are colour *names*, each
 * checked against its own palette before the transaction opens. An unknown name,
 * a stale id, an object that is not a shape and a change that would change
 * nothing all return `false` having written nothing; a call carrying both keys
 * with one of them invalid writes neither, so a shape is never left half styled.
 *
 * Only the named field is written: position, size, kind and label are untouched,
 * which is what makes recolouring safe while the other person is typing in it.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const map = readShapeMap(doc, id);
  if (map === undefined) return false;

  const fill = style.fill;
  const stroke = style.stroke;
  if (fill !== undefined && !isFillColor(fill)) return false;
  if (stroke !== undefined && !isStrokeColor(stroke)) return false;

  const changesFill = fill !== undefined && map.get('fill') !== fill;
  const changesStroke = stroke !== undefined && map.get('stroke') !== stroke;
  if (!changesFill && !changesStroke) return false;

  doc.transact(() => {
    if (changesFill) map.set('fill', fill);
    if (changesStroke) map.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/** The fill and outline names of a shape, as the toolbar shows them. */
export function getShapeStyle(doc: Y.Doc, id: string): { fill: FillColor; stroke: StrokeColor } {
  const map = readShapeMap(doc, id);
  const fill = map?.get('fill');
  const stroke = map?.get('stroke');
  return {
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
  };
}

/** Every shape on the board, in drawing order. */
export function shapeSnapshots(doc: Y.Doc): ShapeSnap[] {
  return objectSnapshot(doc).filter((object): object is ShapeSnap => object.type === SHAPE_TYPE);
}
