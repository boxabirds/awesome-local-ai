/**
 * Stroke objects: what a stroke is, how it is stored, and what may be done to it.
 *
 * A stroke is the fourth object type on the board and it is written to the same `objects` map as a sticky note,
 * with the same rules — one `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation, errors as values rather
 * than exceptions, and no write that would change nothing. What belongs to a stroke alone (its points, the box
 * they were drawn in, its colour and its nib) is in this file, which is what lets `board-model.ts` go on
 * knowing nothing about types.
 *
 * **A stroke stores where the pen went, and nothing about how to draw it.** The points are board coordinates,
 * the colour and the nib are *names* (`"purple"`, `"thick"`) and the hex and the width come out of the settings
 * on every draw — the same decision a shape makes with its kind and a text object makes with its size. A board
 * written by a story that added a seventh ink therefore still loads here: the unknown name is reported as the
 * default rather than hidden, and the document is not rewritten to make the lie tidy.
 *
 * **The points are stored inside the box, not on the board.** They are offsets from the stroke's own `x`/`y`,
 * measured at the size the stroke was drawn at, which is kept alongside them as `baseWidth`/`baseHeight`. That
 * is what lets story 7's generic resize — which writes four numbers and knows nothing about strokes — scale a
 * drawing of four thousand points: `scaledPoints` multiplies the stored offsets by however big the box has
 * become. Had the points been stored as absolute board coordinates, a resize would have had to rewrite every
 * one of them, in one transaction, on five screens at once, and a stroke being resized by two people at once
 * would have been a fight between two sets of four thousand numbers.
 *
 * **A stroke is not simplified, split or smoothed here.** That is `../geometry/simplify.ts`; this file decides
 * what fits in a record, and refuses what does not. A stroke with no points, a point that is not a point, a
 * colour that is not one of the six and a nib that is not one of the three all answer `null` and cost the
 * document nothing — no `z` consumed, no sync message, no empty step in five people's undo histories.
 */
import * as Y from 'yjs';

import { LOCAL_ORIGIN, registerKnownObjectType, registerObjectReader } from '../board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  MAX_OBJECT_SIZE_WORLD,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  isPenColor,
  isPenThickness,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point } from '../geometry';
import { distanceToPolyline } from '../geometry/polyline';

/** Object discriminator stored on every stroke. */
export const STROKE_OBJECT_TYPE = 'stroke';

const OBJECTS_KEY = 'objects';

/**
 * A stroke as the document holds it.
 *
 * It does not extend `ObjectSnapshot`, and the reason is worth two lines because it looks like an oversight:
 * the board's `color` field means one of the six *paper* colours of a sticky note, and a stroke's `color` means
 * one of the six *inks* of a pen. The two sets share three names and disagree about all of them (`blue` is a
 * pale square on a note and a dark line on a stroke), so a single field cannot hold both honestly. The
 * document key is `color` for both — a stroke's box, position and stacking are read by the generic board
 * readers exactly as a note's are — while the type of a stroke's own fields says which six it means. Where the
 * two meet is `snapshot()`, which reports a stroke as an `ObjectSnapshot` whose colour is a pen's; that is the
 * price of one map for all the types, and `isStrokeSnapshot` is the way back to the truth.
 */
export interface StrokeSnap {
  id: string;
  type: 'stroke';
  /** Where the drawing is, including half a nib of paint around it. */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  /** The nib the stroke was drawn with, as stored. An unheard-of name reads as the default. */
  thickness: PenThickness;
  /** The ink the stroke is drawn in, as stored. An unheard-of name reads as the default. */
  color: PenColor;
  /** Who made it. Anonymised in this build, like a sticky note's. */
  createdBy: string;
  /**
   * The drawing, as `x0, y0, x1, y1, …` — offsets from this stroke's own `x`/`y`, at the size in
   * `baseWidth`/`baseHeight`.
   *
   * Flat, and not an array of `{x, y}` objects, because it is one stored value that is written once and read on
   * every frame: half as many numbers in the document, half as many in the sync message, and nothing to
   * allocate per point while drawing. It is never edited a point at a time — a stroke is immutable after it is
   * drawn, and only the box around it ever changes.
   */
  points: readonly number[];
  /** How big the box was when the points were stored in it, which is the ruler every later size is measured by. */
  baseWidth: number;
  baseHeight: number;
}

/**
 * Whether this is a stroke, with the fields a stroke has.
 *
 * The parameter is `unknown`, and that is the same story as `StrokeSnap` not extending `ObjectSnapshot`: a
 * type predicate's type has to fit inside the type it was handed, and a stroke's colour does not fit inside the
 * board's. So this asks about structure and is willing to be handed anything — a snapshot of unknown type, a
 * prop handed to a component, an object off the wire — which is the same question, and a more honest one.
 *
 * The check is structural rather than a comparison of `type`, for the reason `isShapeSnapshot` gives: the
 * generic `snapshot` reports a record of type `'stroke'` even when it could not read the drawing in it, and a
 * guard that asked only about `type` would promise points that are `undefined`.
 */
export function isStrokeSnapshot(object: unknown): object is StrokeSnap {
  if (typeof object !== 'object' || object === null) return false;
  const candidate = object as Partial<StrokeSnap>;
  return (
    candidate.type === STROKE_OBJECT_TYPE &&
    Array.isArray(candidate.points) &&
    candidate.points.length >= 2 &&
    isPenColor(candidate.color) &&
    isPenThickness(candidate.thickness) &&
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    Number.isFinite(candidate.baseWidth) &&
    Number.isFinite(candidate.baseHeight)
  );
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** Any object by id, whatever its type, as long as it says what it is. */
function objectOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objects.get(id);
  if (!(object instanceof Y.Map) || typeof object.get('type') !== 'string') return undefined;
  return object;
}

/** A stroke by id, or undefined when there is no object of that id or it is some other type. */
function strokeObjectOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const object = objectOf(objects, id);
  return object?.get('type') === STROKE_OBJECT_TYPE ? object : undefined;
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

/**
 * Points as they may be stored: a flat list of real numbers, at least one point's worth.
 *
 * Anything else — a list with a `NaN` in it, an odd number of coordinates (a record that lost a number on the
 * way to somebody else's screen), an array of objects, a JSON string — is not a drawing, and is answered `null`
 * rather than repaired. A drawing cannot be guessed at: the closest thing to repairing a lost coordinate is
 * inventing one, and an invented point in the middle of a signature is a forgery.
 */
function pointsOf(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length % 2 !== 0) return null;
  const points: number[] = [];
  for (const entry of value) {
    if (!finite(entry)) return null;
    points.push(entry);
  }
  return points;
}

/** How much room a list of stored offsets takes up: the box the drawing fits in, padding excluded. */
function extentOf(points: readonly number[]): { x: number; y: number; width: number; height: number } {
  let lowX = Number.POSITIVE_INFINITY;
  let lowY = Number.POSITIVE_INFINITY;
  let highX = Number.NEGATIVE_INFINITY;
  let highY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < lowX) lowX = x;
    if (x > highX) highX = x;
    if (y < lowY) lowY = y;
    if (y > highY) highY = y;
  }
  return { x: lowX, y: lowY, width: highX - lowX, height: highY - lowY };
}

/** How far the pen may be from the edge of its own drawing: half a nib, because paint is laid on both sides. */
function paintOf(thickness: PenThickness): number {
  return PEN_THICKNESS_WORLD[thickness] / 2;
}

/** The width a stored nib name means, defaulting a name this build has not heard of. */
export function penWidthOf(name: unknown): number {
  return isPenThickness(name) ? PEN_THICKNESS_WORLD[name] : PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
}

/**
 * The paint a stored ink name means, or the default paint for a name this build has not heard of.
 *
 * A name outside the six is not nothing: a stroke drawn by a future build in a seventh ink arrives here as a
 * stroke, and a stroke that paints nothing would be a stroke people cannot see and can still click — the worst
 * combination available. The record keeps the name it was written with, so a build that knows the seventh ink
 * draws it again.
 */
export function strokePaint(name: unknown): string {
  return isPenColor(name) ? PEN_COLORS[name] : PEN_COLORS[DEFAULT_PEN_COLOR];
}

/** How thick the pen that drew this stroke is, in board units, at the size the stroke is drawn now. */
export function strokePenWidth(stroke: StrokeSnap): number {
  return penWidthOf(stroke.thickness);
}

/** Round to a thousandth of a board unit, which is what stored offsets are kept at. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * A stroke as it is stored, or `null` when the record cannot be drawn.
 *
 * Two kinds of damage are answered differently, and the difference is the one the board has always drawn. A
 * record with no position, or no drawing in it, is not a stroke anyone can see or click, so it is left off —
 * the same way an arrow whose ends cannot be read is left off. A record that has a drawing and a position but
 * has lost its *size* is a stroke, and it is drawn at the size its drawing was drawn at, which is arithmetic
 * this file can do and is never the sticky note's default size the generic reader would have handed out.
 */
function readStrokeObject(id: string, object: Y.Map<unknown>): StrokeSnap | null {
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  if (!finite(x) || !finite(y) || !finite(z)) return null;

  const points = pointsOf(object.get('points'));
  if (points === null) return null;

  const storedColor = object.get('color');
  const storedThickness = object.get('thickness');
  // An unheard-of name is reported as the name of the thing it is drawn as, and the document keeps what it
  // held: the rewrite a future build would want is in the settings, not in five people's documents.
  const color: PenColor = isPenColor(storedColor) ? storedColor : DEFAULT_PEN_COLOR;
  const thickness: PenThickness = isPenThickness(storedThickness) ? storedThickness : DEFAULT_PEN_THICKNESS;

  // The size the drawing was drawn at, which the record keeps as the ruler for every later size. A record that
  // never had one (a stroke written by a build that forgot it) is its own base: its scale is then one, which
  // is the only answer that leaves the drawing the size it is.
  const drawn = extentOf(points);
  const paint = paintOf(thickness);
  const baseWidth = positive(object.get('baseWidth')) ?? drawn.width + paint * 2;
  const baseHeight = positive(object.get('baseHeight')) ?? drawn.height + paint * 2;

  // The box as it stands, which is the base unless somebody resized it. A stroke whose stored size is unusable
  // is reported at its drawn size rather than at the board's default for a sticky note: four hundred units of
  // note would scale a signature up until it covered the board, and then nobody could tell why the room was
  // covered in handwriting.
  const width = positive(object.get('width')) ?? baseWidth;
  const height = positive(object.get('height')) ?? baseHeight;

  const createdAt = object.get('createdAt');
  const createdBy = object.get('createdBy');

  return Object.freeze({
    id,
    type: 'stroke' as const,
    x,
    y,
    width,
    height,
    z,
    createdAt: finite(createdAt) ? createdAt : 0,
    color,
    thickness,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    points,
    baseWidth,
    baseHeight,
  });
}

function positive(value: unknown): number | undefined {
  return finite(value) && value > 0 ? value : undefined;
}

/** A stroke by id, or `null` when there is none, or what is there is not a stroke that can be drawn. */
export function readStroke(doc: Y.Doc, id: string): StrokeSnap | null {
  const object = strokeObjectOf(objectsOf(doc), id);
  return object === undefined ? null : readStrokeObject(id, object);
}

/**
 * The strokes to draw, in stacking order: ascending `z`, ties broken by id, as `snapshot` orders everything.
 *
 * Only the ones that can be drawn are in it. A record that this build cannot read is left in the document,
 * where a build that can read it will find it, rather than being deleted on the strength of one build's not
 * understanding it.
 */
export function strokeSnapshots(doc: Y.Doc): readonly StrokeSnap[] {
  const strokes: StrokeSnap[] = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map) || object.get('type') !== STROKE_OBJECT_TYPE) continue;
    const stroke = readStrokeObject(id, object);
    if (stroke !== null) strokes.push(stroke);
  }
  strokes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(strokes);
}

/** What a gesture described, before the board decides whether it is a stroke at all. */
export interface StrokeSpec {
  /**
   * Where the pen went, in board units, in the order it went there.
   *
   * Not simplified, not relative to anything, and not empty: an empty list is a pen that never came down. A
   * list of one point is a tap, which is a stroke and is stored as one.
   */
  points: readonly Point[];
  /** One of the six inks, or nothing for the one the pen is set to. Checked, not assumed. */
  color?: string;
  /** One of the three nibs, or nothing for the middle one. */
  thickness?: string;
}

/**
 * Draw a stroke: put the record of what the pen did into the document, in one transaction.
 *
 * One transaction, always — points, box, ink, nib, `z` and all. A stroke that arrived in three transactions
 * would appear on somebody else's screen as a box, then a colour, then a drawing, and would leave three steps
 * in their undo history where one drawing ought to be one.
 *
 * The box is the drawing with half a nib of paint added around it, and it is padded rather than tight because
 * paint is laid on *both sides* of the points: a tight box would crop the top and left of every stroke and
 * would seat the selection's handles on top of the drawing.
 *
 * Returns the new id, or `null` for a stroke that cannot be drawn. `color` and `thickness` are typed as
 * `string` and checked here rather than trusted from a toolbar, the same way `createShape` takes a `kind` of
 * `string`: whatever arrives over a network is a string until someone has looked at it.
 */
export function createStroke(doc: Y.Doc, spec: StrokeSpec, createdBy?: string): string | null {
  const source = Array.isArray(spec?.points) ? spec.points : null;
  if (source === null || source.length === 0) return null;

  const color = spec.color === undefined ? DEFAULT_PEN_COLOR : spec.color;
  const thickness = spec.thickness === undefined ? DEFAULT_PEN_THICKNESS : spec.thickness;
  if (!isPenColor(color) || !isPenThickness(thickness)) return null;

  // Every point has to be a point. One `NaN` would be a stroke drawn from nowhere, taking a `z`, invisible to
  // every pointer on five screens, and permanent until somebody found it.
  const flat: number[] = [];
  for (const point of source) {
    if (typeof point !== 'object' || point === null) return null;
    if (!finite(point.x) || !finite(point.y)) return null;
    flat.push(point.x, point.y);
  }

  const paint = paintOf(thickness as PenThickness);
  const drawn = extentOf(flat);
  // Centred growth for a box that outgrew the board: the size is clamped and the origin moves by half of what
  // was taken off, so the drawing stays where it was drawn whatever the box says. A stroke wider than the
  // board is a rare thing — it takes a drawing a kilometre across at 100% — but a box of no area is a stroke
  // that can never be selected, and the board has a maximum for a reason.
  const width = Math.min(drawn.width + paint * 2, MAX_OBJECT_SIZE_WORLD);
  const height = Math.min(drawn.height + paint * 2, MAX_OBJECT_SIZE_WORLD);
  const x = drawn.x - paint - (width - (drawn.width + paint * 2)) / 2;
  const y = drawn.y - paint - (height - (drawn.height + paint * 2)) / 2;

  // Stored relative to the box, at the size the box is now, so that `scaledPoints` of a freshly drawn stroke
  // returns exactly the points that went in — to within the three decimals the record keeps, which is a
  // thousandth of a board unit and a hundredth of the thinnest line on it.
  const relative: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    relative.push(round(flat[i]! - x), round(flat[i + 1]! - y));
  }

  const objects = objectsOf(doc);
  const id = newId();
  const stroke = new Y.Map<unknown>();
  const z = highestZ(objects) + 1;

  doc.transact(() => {
    stroke.set('type', STROKE_OBJECT_TYPE);
    stroke.set('x', round(x));
    stroke.set('y', round(y));
    stroke.set('width', round(width));
    stroke.set('height', round(height));
    stroke.set('baseWidth', round(width));
    stroke.set('baseHeight', round(height));
    stroke.set('z', z);
    stroke.set('createdAt', Date.now());
    stroke.set('color', color);
    stroke.set('thickness', thickness);
    stroke.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    stroke.set('points', relative);
    objects.set(id, stroke);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Where the drawing is now, in board units: the stored offsets, scaled to whatever size the box has become.
 *
 * This is the whole of what a resize does to a stroke. Story 7 writes four numbers into the record and this
 * multiplies; nothing has to be rewritten point by point, so a stroke can be resized by one person while four
 * others watch, and the drawing they see scale is the drawing that was drawn.
 *
 * The scale is `width / baseWidth` and nothing else: `baseWidth` is the box the points were stored against, and
 * it is written once, at creation, and never again. A record with no usable base scale has nothing to be
 * scaled against and is drawn at the size it was drawn at (scale one) rather than at `Infinity`.
 *
 * The nib is deliberately not in this arithmetic: a bigger drawing keeps the line it was drawn with
 * (`pen.resize`), which is why a signature scaled up looks like the same signature photographed rather than
 * like a signature drawn again with a thicker pen.
 */
export function scaledPoints(stroke: StrokeSnap): Point[] {
  if (!isFinitePositive(stroke?.baseWidth) || !isFinitePositive(stroke?.baseHeight)) return offsets(stroke);
  const sx = stroke.width / stroke.baseWidth;
  const sy = stroke.height / stroke.baseHeight;
  const points: Point[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    points.push({ x: stroke.x + stroke.points[i]! * sx, y: stroke.y + stroke.points[i + 1]! * sy });
  }
  return points;
}

function isFinitePositive(value: number | undefined): value is number {
  return finite(value) && (value as number) > 0;
}

/** The drawing where it was drawn, with no scaling: the answer for a record that cannot be scaled. */
function offsets(stroke: StrokeSnap): Point[] {
  const points: Point[] = [];
  const source = Array.isArray(stroke?.points) ? stroke.points : [];
  for (let i = 0; i + 1 < source.length; i += 2) {
    const x = source[i]!;
    const y = source[i + 1]!;
    if (finite(x) && finite(y)) points.push({ x: stroke.x + x, y: stroke.y + y });
  }
  return points;
}

/**
 * Whether a point is on a stroke: how far it is from the line, against how far a click may be and still mean
 * the line.
 *
 * The tolerance is `max(half the nib, six screen pixels)`. Half the nib, because a stroke paints half its width
 * on either side of its points and a click that lands on the paint and misses the centreline would select a
 * stroke nobody can see they are pointing at. Six screen pixels — divided by the zoom, because the six are a
 * fact about a pointer on a screen and the board is measured in board units — because a hairline is impossible
 * to click on otherwise. It is the same rule story 10 gave for arrows, for the same reason, at the same
 * distance: a pointer that can hit an arrow ought to be able to hit a stroke.
 *
 * A stroke of one point — a tap, a dot — is measured to that point. `distanceToPolyline` answers `Infinity`
 * for anything shorter than a segment, which is right for a line and would make every dot on the board
 * impossible to select.
 */
export function strokeHit(stroke: StrokeSnap, point: Point, zoom: number): boolean {
  if (!isStrokeSnapshot(stroke) || !finite(point?.x) || !finite(point?.y)) return false;
  const line = scaledPoints(stroke);
  const scale = finite(zoom) && zoom > 0 ? zoom : 1;

  let distance: number;
  if (line.length === 1) {
    const dot = line[0]!;
    distance = Math.hypot(point.x - dot.x, point.y - dot.y);
  } else {
    distance = distanceToPolyline(line, point);
  }
  return distance <= Math.max(strokePenWidth(stroke) / 2, STROKE_HIT_TOLERANCE_PX / scale);
}

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `stroke-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

/**
 * The fields a stroke stores that the generic reader of the board model does not know about.
 *
 * A stroke keeps its own box — the box is the drawing's, and moving it writes numbers into it, which is exactly
 * what an arrow cannot do — so it registers fields and no resolver. What it reports is what `strokeSnapshots`
 * reads, for the same reason the two have to agree: a snapshot that is a stroke to `strokeSnapshots` and not a
 * stroke to `snapshot` would be a stroke the board draws and cannot select. A record it cannot read reports
 * nothing, and is left in the document for a build that can.
 */
function strokeFields(id: string, object: Y.Map<unknown>): Record<string, unknown> {
  const stroke = readStrokeObject(id, object);
  if (stroke === null) return {};
  return {
    color: stroke.color,
    thickness: stroke.thickness,
    createdBy: stroke.createdBy,
    points: stroke.points,
    baseWidth: stroke.baseWidth,
    baseHeight: stroke.baseHeight,
  };
}

/**
 * Strokes announce themselves to the board model: they are reportable, and they report their own fields.
 *
 * A type that never introduces itself is invisible: not marqueed, not selectable, not in a snapshot. The calls
 * are idempotent, so doing them twice — which is what happens in the app — is the same as doing them once.
 */
registerObjectReader(STROKE_OBJECT_TYPE, { fields: (object, _rects, id) => strokeFields(id, object) });
registerKnownObjectType(STROKE_OBJECT_TYPE);
