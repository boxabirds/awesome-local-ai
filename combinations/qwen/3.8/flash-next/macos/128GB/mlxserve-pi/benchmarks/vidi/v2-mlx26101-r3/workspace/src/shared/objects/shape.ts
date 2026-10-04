import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_FONT_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  isFillColor,
  isShapeKind,
  isStrokeColor,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  SHAPE_TYPE,
  canReadObjectType,
  registerObjectReader,
  type ObjectSnapshot,
  type ShapeSnapshot,
} from '../board-model';
import type { Point, Rect } from '../geometry';

/**
 * Shapes on the board (story 10): the schema, and every mutation of it.
 *
 * A shape is a rectangle, an ellipse or a diamond with a label written in the middle of it. It is an
 * ordinary board object otherwise - moved, stacked, marquee-selected, deleted, resized and undone by
 * story 7's and story 8's generic operations on `objects` - and its label is typed into and merged
 * with somebody else's typing exactly like a note's text is, which is why the label is a `Y.Text`
 * from the moment the shape exists.
 *
 * ```text
 * objects/<id>: Y.Map {
 *   type: 'shape'
 *   x, y: number             // top-left, world units
 *   width, height: number    // world units; the box the shape is drawn in
 *   kind: 'rect' | 'ellipse' | 'diamond'
 *   fill: FillColor | 'none'
 *   stroke: StrokeColor
 *   label: Y.Text            // up to SHAPE_LABEL_MAX_CHARS characters
 *   z, createdAt, createdBy
 * }
 * ```
 *
 * There is no `color` field: a shape has two colours, and neither of them is a sticky note's. The
 * box is the shape's drawing box for all three kinds - the box an ellipse is drawn inside, the box a
 * diamond's four points touch - which is what lets an arrow fasten to the midpoint of a side of any
 * of them without knowing which one it is (see `connector-geometry`).
 *
 * Every mutation is one `doc.transact(fn, LOCAL_ORIGIN)`, and a rejected one - unknown kind,
 * non-finite box, colour the product does not have, stale id - returns before a transaction is
 * opened, so it emits no update and costs no sync traffic. Like the rest of `shared`, this module
 * never throws for user-driven input, and knows nothing about pointers, selection or React.
 */

// The type's name is the board model's, because the model's reader has to know it; it is re-exported
// so that the code which writes shapes says `SHAPE_TYPE`, from where it stands.
export { SHAPE_TYPE } from '../board-model';
export type { ShapeSnapshot } from '../board-model';

/** The three kinds, in the order the Shape menu offers them. */
export { SHAPE_KINDS, SHAPE_KIND_LABELS, isShapeKind } from '../config';
export type { FillColor, ShapeKind, StrokeColor } from '../config';

// The model is allowed to read shapes as soon as this module is loaded - the same one-place
// registration story 9 uses for text objects. A client that never imports this file (an older build)
// skips shape objects instead of failing on them, which is the compatibility the PRD asks for.
registerObjectReader(SHAPE_TYPE);

/** What a shape was asked for: the box that was dragged, or the point that was clicked. */
export interface ShapePlacement {
  /** Which shape to draw. An unknown kind is refused, not guessed at. */
  readonly kind: ShapeKind;
  /**
   * The box the drag covered, in world units, or `null` for a click.
   *
   * A box that is not a box - `NaN`, `Infinity`, a zero or negative side - is an error and returns
   * `null`, not a request to draw the standard shape instead: a shape nobody drew at a place that
   * does not exist should not end up somewhere on the board. A box that *is* a box but is too
   * small to be a shape - shorter than {@link SHAPE_MIN_SIZE_WORLD} in either direction - is a
   * different thing, and is a click that drifted: that one gets the standard size.
   */
  readonly rect: Rect | null;
  /** The point that was clicked, or the point the drag started from. */
  readonly at: Point;
  /** Shift was held: both sides take the longer of the two dragged dimensions. */
  readonly square?: boolean;
}

/** The colours of a shape, either or both of which a caller may be asking to change. */
export interface ShapeStylePatch {
  readonly fill?: string;
  readonly stroke?: string;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

/** A member of `objects` that is a shape this client can read. */
function shapeObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = objects.get(id);
  if (object === undefined || !(object instanceof Y.Map) || object.get('type') !== SHAPE_TYPE) {
    return null;
  }
  if (!canReadObjectType(SHAPE_TYPE)) {
    return null;
  }
  return object;
}

function readNumber(object: YObject, key: string): number {
  const value = object.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readZ(object: YObject): number {
  return readNumber(object, 'z');
}

/** Highest stacking order of any readable object; 0 for an empty document. */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map && canReadObjectType(object.get('type'))) {
      max = Math.max(max, readZ(object));
    }
  }
  return max;
}

/**
 * Ids are `crypto.randomUUID()`, so shapes created offline by different peers (story 3) never
 * collide with a note, an arrow or each other (the same rule as the board model's).
 */
function newId(): string {
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

function isPoint(value: Point | null | undefined): value is Point {
  return value !== null && value !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isRect(value: Rect | null): value is Rect {
  return (
    value !== null &&
    [value.x, value.y, value.width, value.height].every((part) => Number.isFinite(part))
  );
}

/**
 * Shift's square: both sides take the longer dragged dimension, held at the corner the drag started
 * from.
 *
 * "Anchored at the drag origin" is the part worth spelling out. The origin is a *corner* of the box
 * rather than inside it, because a drag goes from where the pointer went down to where it left: hold
 * the corner the pointer started at and the shape grows the way the drag went, which is what the
 * dashed preview the person was watching showed them. Taking the box's own top-left instead would
 * slide a shape drawn up and to the left of its origin somewhere the pointer never was.
 */
function squareRect(rect: Rect, at: Point): Rect {
  const side = Math.max(rect.width, rect.height);
  const x = at.x < rect.x ? rect.x + rect.width - side : rect.x;
  const y = at.y < rect.y ? rect.y + rect.height - side : rect.y;
  return { x, y, width: side, height: side };
}

/**
 * The box the person asked for, in board units: the dragged box, squared if Shift was held, or
 * `null` for a click.
 *
 * Squaring happens *before* the minimum size is looked at, because that is what the person was
 * looking at: a drag 19 units wide with Shift held drew a 200 unit square in the preview, and to
 * answer it with the standard size would be to disagree with the preview and with the modifier.
 */
function boxOf(placement: ShapePlacement): Rect | null {
  if (placement.rect === null) {
    return null;
  }
  return placement.square === true ? squareRect(placement.rect, placement.at) : placement.rect;
}

/** The box a click makes: the standard size, round the point that was clicked. */
function centredRect(at: Point): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

function isBigEnough(rect: Rect): boolean {
  return rect.width >= SHAPE_MIN_SIZE_WORLD && rect.height >= SHAPE_MIN_SIZE_WORLD;
}

/**
 * Put a shape on the board.
 *
 * Three ways of being asked, and two answers:
 *
 * - **A drag** - `rect` is the box the drag covered, and the shape is exactly that box. At 100% zoom
 *   a screen drag of (100, 100) to (300, 220) is a 200x120 shape at (100, 100), because one screen
 *   pixel is one board unit there.
 * - **A click** - `rect: null`, or a box narrower than {@link SHAPE_MIN_SIZE_WORLD} in either
 *   direction, which is a click whose pointer drifted. The shape is the standard
 *   {@link SHAPE_DEFAULT_SIZE_WORLD} square *centred on `at`*, the way a sticky note is: the shape
 *   appears under the pointer that asked for it. A box is centred on a point rather than starting
 *   at it because a shape is drawn around the place it was aimed at, and the pointer is still there.
 * - **Shift** - `square: true` takes the longer of the two dragged dimensions for both sides.
 *
 * It starts with no label, in the default colours - a white fill and a dark outline, which is the
 * pair that is legible on the board's grid before anybody has chosen anything - and above every
 * other object.
 *
 * @returns the new id, or `null` for a kind the product does not have or a box or point that is not
 * a place on the board. Nothing at all is written in the rejected case.
 */
export function createShape(doc: Y.Doc, placement: ShapePlacement, by: string): string | null {
  if (!isShapeKind(placement.kind) || !isPoint(placement.at)) {
    return null;
  }
  // A box that is not a box is refused even though there is a point to fall back to: `rect: null`
  // means "a click", and a box of not-a-number means "a drag that went somewhere that is not
  // somewhere" - only the first of those is answered with the standard shape.
  if (placement.rect !== null && !isRect(placement.rect)) {
    return null;
  }
  if (typeof by !== 'string' || by === '') {
    return null;
  }
  const dragged = boxOf(placement);
  const rect = dragged !== null && isBigEnough(dragged) ? dragged : centredRect(placement.at);

  const id = newId();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', SHAPE_TYPE);
    object.set('x', rect.x);
    object.set('y', rect.y);
    object.set('width', rect.width);
    object.set('height', rect.height);
    object.set('kind', placement.kind);
    object.set('fill', DEFAULT_SHAPE_FILL);
    object.set('stroke', DEFAULT_SHAPE_STROKE);
    // A `Y.Text` even when empty: two people typing into one shape merge letter by letter, the way
    // they do in a note. An empty string here would be a label that cannot be typed into.
    object.set('label', new Y.Text());
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', by);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a shape's fill and/or outline.
 *
 * A colour the palette does not have - `'teal'`, `'#FF00FF'`, `'White'`, a number - is refused
 * rather than rounded to the nearest colour, because a colour the product does not offer is not a
 * colour a board may be stored as, and a shape painted with it would be a shape no swatch in the
 * toolbar matches any more. The same goes for a shape that is not there.
 *
 * Only the colour keys are touched: the label, the box, the stacking order and the author are left
 * exactly as they were, which is what lets a colour be one undo step that does not move anything.
 * Setting a colour the shape already has writes nothing - no transaction, so no update on the wire.
 *
 * @returns whether anything changed
 */
export function setShapeStyle(doc: Y.Doc, id: string, style: ShapeStylePatch): boolean {
  const object = shapeObject(objectsOf(doc), id);
  if (object === null) {
    return false;
  }
  const fill = style.fill === undefined ? null : style.fill;
  const stroke = style.stroke === undefined ? null : style.stroke;
  if (fill === null && stroke === null) {
    // Asked to change nothing. Not a failure of the document's, but not a change either.
    return false;
  }
  if (fill !== null && !isFillColor(fill)) {
    return false;
  }
  if (stroke !== null && !isStrokeColor(stroke)) {
    return false;
  }
  const writesFill = fill !== null && object.get('fill') !== fill;
  const writesStroke = stroke !== null && object.get('stroke') !== stroke;
  if (!writesFill && !writesStroke) {
    return false;
  }
  doc.transact(() => {
    if (writesFill) {
      object.set('fill', fill);
    }
    if (writesStroke) {
      object.set('stroke', stroke);
    }
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give a shape the box it was dragged to.
 *
 * A resize of a shape is a plain box - unlike a text object, whose height is a result of its content
 * and cannot be dragged - because a shape is exactly as big as the box it is drawn in: stretching it
 * stretches the drawing, and the label inside re-wraps to the new width on its own.
 *
 * A box below {@link SHAPE_MIN_SIZE_WORLD} is clamped up to it rather than refused, so a handle
 * dragged too small stops at the smallest shape the product draws and still does what the drag was
 * doing. A box that is not a box at all is refused: `NaN` is not a size, and a shape stored at it
 * could not be selected, hit or undone from. The stacking order is not touched - making a shape
 * bigger does not bring it forward.
 *
 * @returns whether the box changed
 */
export function setShapeRect(doc: Y.Doc, id: string, rect: Rect): boolean {
  if (!isRect(rect) || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const object = shapeObject(objectsOf(doc), id);
  if (object === null) {
    return false;
  }
  const width = Math.max(SHAPE_MIN_SIZE_WORLD, rect.width);
  const height = Math.max(SHAPE_MIN_SIZE_WORLD, rect.height);
  if (
    object.get('x') === rect.x &&
    object.get('y') === rect.y &&
    object.get('width') === width &&
    object.get('height') === height
  ) {
    return false;
  }
  doc.transact(() => {
    object.set('x', rect.x);
    object.set('y', rect.y);
    object.set('width', width);
    object.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shape's label as a `Y.Text`, for story 2's editor.
 * `undefined` for a stale id, and for an object that is not a shape at all - a note has a `text`,
 * which is a different field and a different thing.
 *
 * Typing into it is held to {@link SHAPE_LABEL_MAX_CHARS} by the editor that shows it
 * (`clampToLimit`), the way a note's text is held to its own limit: the model does not truncate, so
 * a label written past the limit by another client is drawn as it was written rather than silently
 * shortened behind that client's back.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const label = shapeObject(objectsOf(doc), id)?.get('label');
  return label instanceof Y.Text ? label : undefined;
}

/** Everything a shape's label is laid out from, read in one go at the moment of a measurement. */
export interface ShapeFields {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: ShapeKind;
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  readonly label: string;
  /** The label's own `Y.Text`, so the measuring client can write the box it needs. */
  readonly labelYText: Y.Text;
  /** The font the label is drawn at, in world units. */
  readonly fontPx: number;
  /** The smallest box this shape may be stored at. */
  readonly minSize: number;
}

/**
 * Read a shape's fields, defaulting anything the product does not know exactly as
 * {@link asShapeSnapshot} does.
 *
 * This exists so the client that measures a label never measures it against a size or a box the
 * shape is not drawn at - the same reason story 9 has {@link getTextFields}.
 */
export function getShapeFields(doc: Y.Doc, id: string): ShapeFields | null {
  const object = shapeObject(objectsOf(doc), id);
  const label = object?.get('label');
  if (object === null || !(label instanceof Y.Text)) {
    return null;
  }
  const kind = object.get('kind');
  const fill = object.get('fill');
  const stroke = object.get('stroke');
  return {
    x: readNumber(object, 'x'),
    y: readNumber(object, 'y'),
    width: readNumber(object, 'width'),
    height: readNumber(object, 'height'),
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: label.toString(),
    labelYText: label,
    fontPx: SHAPE_LABEL_FONT_WORLD,
    minSize: SHAPE_MIN_SIZE_WORLD,
  };
}

/**
 * The object as a shape, or `null` when the snapshot is of something else.
 *
 * This is the one place a shape's defaults are decided, which is why the board model's generic
 * reader leaves out a kind or a colour it does not recognise instead of guessing: a document that
 * arrived with `'hexagon'` in it - written by a newer client, or by a hand-written import - is drawn
 * as a rectangle in the default colours rather than vanishing from the board. Story 9 does the same
 * for a text object's size.
 */
export function asShapeSnapshot(object: ObjectSnapshot | undefined): ShapeSnapshot | null {
  if (object === undefined || object.type !== SHAPE_TYPE) {
    return null;
  }
  return {
    ...object,
    type: SHAPE_TYPE,
    kind: isShapeKind(object.kind) ? object.kind : 'rect',
    fill: isFillColor(object.fill) ? object.fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(object.stroke) ? object.stroke : DEFAULT_SHAPE_STROKE,
    label: typeof object.label === 'string' ? object.label : '',
    createdBy: typeof object.createdBy === 'string' ? object.createdBy : undefined,
  };
}

/** The shape's own box, as a {@link Rect}. Shapes carry their boxes; nothing is derived. */
export function shapeRect(shape: ShapeSnapshot): Rect {
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}
