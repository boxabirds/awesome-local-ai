/**
 * Shape objects: the schema and every mutation of it.
 *
 * A shape is the third object type on the board and it is written to the same `objects` map as a sticky
 * note with the same rules — one `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation, errors as
 * values rather than exceptions, no write that would change nothing. What belongs to a shape alone (its
 * `kind`, its two colours, and a label that lives in a `Y.Text` the size of the shape) is in this file,
 * which is what lets `board-model.ts` go on knowing nothing about types.
 *
 * **The box is stored, and the kind is not a component.** A shape holds `x`, `y`, `width`, `height` in
 * board units exactly as a note does, so selection, marquee, grouping and moving need to learn nothing
 * new — and it holds the *name* of a kind (`"diamond"`), never anything about how a diamond is painted.
 * That is the same decision the text object makes with its size: what a board stores is a key, and the
 * number or the picture that key means is looked up from the settings on every draw (design: *shape kind
 * is a stored key*). The consequence is that a board written by a story that added a fifth kind still
 * loads here: the unknown kind is reported as the default rather than hidden, exactly as a text object at
 * an unheard-of size is.
 *
 * **A shape that was clicked is not a shape that was dragged.** A drag carries a box; a click carries a
 * point, and the board answers with the size a shape is born with, centred on where the pointer came up.
 * The rule that decides between them is `shapeRectFor` below and nowhere else, because the tool, the
 * model and the tests all have to agree about when a drag stopped being a drag.
 */
import * as Y from 'yjs';

import { LOCAL_ORIGIN, registerKnownObjectType, registerObjectReader } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type ShapeKind,
  type StrokeColor,
  type FillColor,
  isShapeKind,
  isFillColor,
  isStrokeColor,
} from '../config';
import type { Point, Rect } from '../geometry';
import { finitePoint } from '../geometry';

/** Object discriminator stored on every shape. */
export const SHAPE_OBJECT_TYPE = 'shape';

const OBJECTS_KEY = 'objects';

/** A shape as the document holds it. */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  /** One of the three kinds, never a drawing instruction. */
  kind: ShapeKind;
  /** The stored *name* of a fill (`'blue'`, `'none'`), not a hex value. */
  fill: string;
  /** The stored name of an outline colour. */
  stroke: string;
  /** The label as written. Always a string: a shape with no label field says `''`. */
  label: string;
  /** Who made it. Anonymised in this build, like a sticky note's. */
  createdBy: string;
}

/** What a drag described, before the board decides how big the shape it draws is. */
export interface ShapeSpec {
  /** The kind of shape to draw. An unknown kind creates nothing. */
  kind: string;
  /** The box the pointer swept, as `null` when the pointer never left the pixel it arrived on. */
  rect?: Rect | null;
  /** Where the pointer came up, in board units. Used to place a shape that has no box of its own. */
  at: Point;
  /** Shift held: the box becomes a square with the longer side (TC-04). */
  square?: boolean;
  /** Who is drawing. Stored for the face display of story 6, and anonymised before it gets here. */
  createdBy?: string;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/**
 * Whether this snapshot carries the fields only a shape has, so they can be read off it.
 *
 * The check is structural rather than a comparison of `type`, for the same reason `isTextSnapshot` is:
 * the generic `snapshot` and `readShape` both answer `type: 'shape'` and only one of them has a `kind`.
 * A guard that asked only about `type` would promise a colour that is `undefined`, which is how a shape
 * ends up drawn with `fill="undefined"`.
 */
export function isShapeSnapshot(object: ObjectSnapshot | undefined | null): object is ShapeSnap {
  if (object === undefined || object === null || object.type !== SHAPE_OBJECT_TYPE) return false;
  const withFields = object as Partial<ShapeSnap>;
  return (
    isShapeKind(withFields.kind) &&
    typeof withFields.fill === 'string' &&
    typeof withFields.stroke === 'string' &&
    typeof withFields.label === 'string'
  );
}

/** Any object by id, whatever its type, as long as it says what it is. */
function objectOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objects.get(id);
  if (!(object instanceof Y.Map) || typeof object.get('type') !== 'string') return undefined;
  return object;
}

/** A shape by id, or undefined when there is no object of that id or it is some other type. */
function shapeOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const object = objectOf(objects, id);
  return object?.get('type') === SHAPE_OBJECT_TYPE ? object : undefined;
}

function ytextOf(object: Y.Map<unknown>): Y.Text | undefined {
  const label = object.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** Highest `z` of any object on the board (0 when there are none). */
function highestZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * A box whose width and height are positive, wherever the pointer went.
 *
 * A drag that started bottom-right and ended top-left sweeps a box just as a top-left to bottom-right one
 * does; the tool reports it with the two points it saw, and the shape does not care which way round they
 * came (`geometry.ts`'s `normalizeRect` builds a box from two points, which is a different thing).
 */
function positive(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** The box a shape with no box of its own is drawn at: the standard size, centred on the point. */
export function defaultShapeRect(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

/**
 * The box a create resolves to, given what the pointer did.
 *
 * Three cases, and the order of them is the whole rule:
 *
 * 1. a drag that swept at least `SHAPE_MIN_SIZE_WORLD` on **both** axes keeps the box it swept (TC-03 —
 *    exactly the minimum is kept, because a drag that size was dragged on purpose);
 * 2. a drag that came out too small on either axis, and a pointer that never moved at all, gets the
 *    standard size centred on the point it came up at (TC-02) — a shape the width of a cursor is not a
 *    shape, it is a click;
 * 3. Shift (TC-04) turns whichever box survived into a square whose side is the longer of the two, held
 *    at the corner the box starts from, which is the corner a drag begins from on the common top-left to
 *    bottom-right drag.
 *
 * Returns `null` for input that describes no place at all — a point or a box with a `NaN` in it. That is
 * not the same as a box that came out small: a small box is a drag that meant something, and a `NaN` is
 * arithmetic that went wrong somewhere upstream, which is not a reason to put a shape down.
 */
export function shapeRectFor(spec: {
  rect?: Rect | null;
  at: Point;
  square?: boolean;
}): Rect | null {
  if (!finitePoint(spec.at)) return null;
  const rect = spec.rect;

  if (rect !== null && rect !== undefined) {
    if (!finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) return null;
  }

  let box: Rect;
  if (
    rect !== null &&
    rect !== undefined &&
    Math.abs(rect.width) >= SHAPE_MIN_SIZE_WORLD &&
    Math.abs(rect.height) >= SHAPE_MIN_SIZE_WORLD
  ) {
    box = positive(rect);
  } else {
    box = defaultShapeRect(spec.at);
  }

  if (spec.square === true) {
    const side = Math.max(box.width, box.height);
    box = { x: box.x, y: box.y, width: side, height: side };
  }

  return {
    x: box.x,
    y: box.y,
    width: clamp(box.width, SHAPE_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD),
    height: clamp(box.height, SHAPE_MIN_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD),
  };
}

/**
 * One shape, read straight from the document.
 *
 * This is how a shape component gets at the fields the generic snapshot does not carry. A document that
 * stores something unusable is read as the nearest usable thing rather than as nothing: a shape whose kind
 * came from a story that added a fourth kind is drawn as a rect rather than hidden. Its colours are the
 * exception — a colour name this build cannot paint is kept exactly as written, because it is still the
 * colour somebody chose, and what falls back to the default is the paint (`shapeFillPaint`), not the record.
 */
export function readShape(doc: Y.Doc, id: string): ShapeSnap | null {
  const object = shapeOf(objectsOf(doc), id);
  return object === undefined ? null : readShapeObject(id, object);
}

/** Read one stored shape. Returns null for an object that is not a usable shape at all. */
export function readShapeObject(id: string, object: Y.Map<unknown>): ShapeSnap | null {
  if (object.get('type') !== SHAPE_OBJECT_TYPE) return null;
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  if (!finite(x) || !finite(y) || !finite(z)) return null;

  const label = ytextOf(object);
  const width = object.get('width');
  const height = object.get('height');
  const fill = object.get('fill');
  const stroke = object.get('stroke');
  const kind = object.get('kind');
  const createdBy = object.get('createdBy');
  const createdAt = object.get('createdAt');

  return Object.freeze({
    id,
    type: 'shape' as const,
    x,
    y,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    // A shape with no stored box is the size a shape is born with. This happens only for a document that
    // was written by something which did not go through `createShape`, and a shape with no size could be
    // neither selected nor moved.
    width: finite(width) && width > 0 ? width : SHAPE_DEFAULT_SIZE_WORLD,
    height: finite(height) && height > 0 ? height : SHAPE_DEFAULT_SIZE_WORLD,
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: typeof fill === 'string' ? fill : DEFAULT_SHAPE_FILL,
    stroke: typeof stroke === 'string' ? stroke : DEFAULT_SHAPE_STROKE,
    label: label ? label.toString() : '',
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  });
}

/** Every shape on the board, in stacking order — the same order the board draws them in. */
export function shapeSnapshots(doc: Y.Doc): readonly ShapeSnap[] {
  const shapes: ShapeSnap[] = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map)) continue;
    const read = readShapeObject(id, object);
    if (read !== null) shapes.push(read);
  }
  shapes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(shapes);
}

/**
 * Put a shape on the board in one transaction, and return its id.
 *
 * Nothing about this function knows what the kind looks like: it stores the key. The box comes from
 * `shapeRectFor`, so a click and a drag are decided in one place, and `at` is the point the pointer came
 * up at — a shape that has no box of its own is centred there, the way a note is centred on the point it
 * was made at.
 *
 * A kind the board cannot draw, or a point that is not a place, creates nothing and opens no transaction:
 * a shape at `NaN` would be on the board, taking a `z`, unreachable by any pointer.
 */
export function createShape(
  doc: Y.Doc,
  spec: { kind: string; rect?: Rect | null; at: Point; square?: boolean; createdBy?: string },
): string | null {
  if (!isShapeKind(spec.kind)) return null;
  const box = shapeRectFor(spec);
  if (box === null) return null;

  const objects = objectsOf(doc);
  const id = newId();
  const shape = new Y.Map<unknown>();
  const z = highestZ(objects) + 1;

  doc.transact(() => {
    shape.set('type', SHAPE_OBJECT_TYPE);
    shape.set('kind', spec.kind);
    shape.set('x', box.x);
    shape.set('y', box.y);
    shape.set('width', box.width);
    shape.set('height', box.height);
    shape.set('z', z);
    shape.set('createdAt', Date.now());
    shape.set('fill', DEFAULT_SHAPE_FILL);
    shape.set('stroke', DEFAULT_SHAPE_STROKE);
    shape.set('label', new Y.Text(''));
    shape.set('createdBy', typeof spec.createdBy === 'string' ? spec.createdBy : '');
    objects.set(id, shape);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Choose a fill or an outline colour, and nothing else.
 *
 * One transaction for both fields when both changed, because two swatches clicked together — or one call
 * from a toolbar that was handed a colour a colleague's swatch just changed — is one thing to undo. A
 * colour that is not one of ours is refused rather than guessed at, and a colour already worn is not
 * written again: a write that changes nothing costs a sync message and an empty step in five histories.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: string; stroke?: string },
): boolean {
  const object = shapeOf(objectsOf(doc), id);
  if (object === undefined) return false;

  const fill = style?.fill;
  const stroke = style?.stroke;
  if (fill !== undefined && !isFillColor(fill)) return false;
  if (stroke !== undefined && !isStrokeColor(stroke)) return false;

  const changesFill = fill !== undefined && object.get('fill') !== fill;
  const changesStroke = stroke !== undefined && object.get('stroke') !== stroke;
  if (!changesFill && !changesStroke) return false;

  doc.transact(() => {
    if (changesFill) object.set('fill', fill);
    if (changesStroke) object.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The label itself, for typing into.
 *
 * A shape whose label field is missing or of the wrong type is repaired in place, because the editor has
 * to have something to write to and there is nothing to preserve where there was nothing readable.
 * Returns undefined for an id that is not a shape: a keystroke must never create an object.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = shapeOf(objectsOf(doc), id);
  if (object === undefined) return undefined;

  const label = ytextOf(object);
  if (label !== undefined) return label;

  const replacement = new Y.Text('');
  doc.transact(() => {
    object.set('label', replacement);
  }, LOCAL_ORIGIN);
  return replacement;
}

/** The label as written, or `''` for an id that is not a shape. */
export function getShapeText(doc: Y.Doc, id: string): string {
  const object = shapeOf(objectsOf(doc), id);
  const label = object === undefined ? undefined : ytextOf(object);
  return label ? label.toString() : '';
}

/**
 * Whether a stored colour name is one the board can paint, said in the shape's terms so the toolbar and
 * the model answer with the same word as the settings.
 */
export function shapeColorIsKnown(kind: 'fill' | 'stroke', name: unknown): boolean {
  return kind === 'fill' ? isFillColor(name) : isStrokeColor(name);
}

/**
 * The paint a stored fill name means, or the default paint for a name this build has never heard of.
 *
 * The name is what is stored and this is what is drawn, which is the difference that lets a shape outlive
 * a palette change: the record keeps `teal`, the screen shows white, and a story that adds teal to the
 * settings changes what everybody sees without rewriting what anybody wrote. `none` paints nothing at all.
 */
export function shapeFillPaint(name: unknown): string {
  return isFillColor(name) ? SHAPE_FILL_COLORS[name] : SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL];
}

/** The paint a stored outline name means, or the default paint for an unknown name. */
export function shapeStrokePaint(name: unknown): string {
  return isStrokeColor(name) ? SHAPE_STROKE_COLORS[name] : SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE];
}

/** The default colour names, for a component that has a stored name it cannot paint. */
export const SHAPE_DEFAULT_COLORS: Readonly<{ fill: FillColor; stroke: StrokeColor }> = Object.freeze({
  fill: DEFAULT_SHAPE_FILL,
  stroke: DEFAULT_SHAPE_STROKE,
});

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `shape-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

/**
 * Shapes announce themselves to the board model, the way the client registry does for the types it draws
 * and the way `text.ts` does for text.
 *
 * A type that never introduces itself is invisible: not marqueed, not selectable, not in a snapshot. The
 * call is idempotent, so doing it twice — which is what happens in the app — is the same as doing it once.
 */
/**
 * The fields a shape stores that the generic reader of the board model does not know about.
 *
 * A shape keeps its own box — the box is the shape, and moving it writes numbers into it, which is exactly
 * what an arrow cannot do — so it registers fields and no resolver. What it reports is what
 * `readShapeObject` reads, for the same reason the two have to agree: a snapshot that is a shape to
 * `shapeSnapshots` and not a shape to `snapshot` would be a shape the board draws and cannot select.
 */
function shapeFields(id: string, object: Y.Map<unknown>): Record<string, unknown> {
  const shape = readShapeObject(id, object);
  if (shape === null) return {};
  return { kind: shape.kind, fill: shape.fill, stroke: shape.stroke, label: shape.label, createdBy: shape.createdBy };
}

/**
 * Shapes announce themselves to the board model: they are reportable, and they report their own fields.
 *
 * A type that never introduces itself is invisible: not marqueed, not selectable, not in a snapshot. The
 * calls are idempotent, so doing them twice — which is what happens in the app — is the same as doing them
 * once.
 */
registerObjectReader(SHAPE_OBJECT_TYPE, { fields: (object, _rects, id) => shapeFields(id, object) });
registerKnownObjectType(SHAPE_OBJECT_TYPE);
