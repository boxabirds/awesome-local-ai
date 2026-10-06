/**
 * The shape object: its schema and every mutation the interface can perform on it (story 10).
 *
 * A shape is a rectangle, an ellipse or a diamond written anywhere on the board, with a label it can
 * carry. It is an entry in the same `objects` map every other type uses — so the board model lists it,
 * select-all takes it, one delete removes it and the live room carries it — plus four fields of its own:
 *
 * - `kind`: which of the three it is. Chosen when it is made and never changed: the PRD's out-of-scope
 *   list says a shape's kind does not change afterwards, so nothing below takes a kind after creation.
 * - `text`: a `Y.Text`, CRDT text like a sticky note's, so two people can type in one label and both
 *   keep their characters. It is the same field a note's words live in, which is why the snapshot's
 *   `text` reads the same for both.
 * - `fill` and `stroke`: what it is filled with and what its outline is drawn in. Both are stored as
 *   the name the toolbar used, or as a raw CSS colour for anything a newer client invented.
 * - `strokeWidth`: how thick that outline is, in world units, so it scales with the shape.
 *
 * The box is stored like every other type's: a shape is a rectangle even when it is drawn as an
 * ellipse, and hit-testing, selection and the marquee all treat it as one (TC-08's diamond is a
 * rectangle for everything except the drawing).
 *
 * Every write goes through `doc.transact(fn, LOCAL_ORIGIN)`, like the sticky-note and text functions:
 * origin is how the board tells its own work from somebody else's, and it is what lets the label's
 * length limit police this person's keystrokes and nobody else's.
 *
 * These functions do **not** open an undo step: like `resizeObjects`, they are the thing that goes
 * *inside* a step, and the interface opens the step around them (see `src/client/board/undo.ts`).
 */

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
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
  type StrokeColor,
  type FillColor,
} from '../config';
import { deleteObjects, initDoc, LOCAL_ORIGIN, OBJECTS_MAP, type ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';

export const SHAPE_OBJECT_TYPE = 'shape';

/** The three kinds, re-exported beside {@link ShapeSnapshot} so a reader needs one import. */
export type { ShapeKind } from '../config';

/** One shape on the board, as the snapshot reads it. */
export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  /** Rectangle, ellipse or diamond. */
  kind: ShapeKind;
  /** What it is filled with: a name from `SHAPE_FILL_COLORS`, or a colour a newer client invented. */
  fill: string;
  /** What its outline is drawn in, same rule. */
  stroke: string;
  /** Its label, as text the way every other object's words are read: the shape's own `Y.Text`. */
  text: string;
  /** How thick that outline is, in world units. */
  strokeWidth: number;
}

/** The object is one of ours. */
export const isShapeSnapshot = (object: ObjectSnapshot | null | undefined): object is ShapeSnapshot =>
  object !== null && object !== undefined && object.type === SHAPE_OBJECT_TYPE;

/** A kind this build knows how to draw. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** The kind to draw when a document holds one this client does not know. */
export const shapeKindOrDefault = (value: unknown): ShapeKind => (isShapeKind(value) ? value : DEFAULT_SHAPE_KIND);

/**
 * The colour to paint a fill with: the name the toolbar sent, or the colour itself when the document
 * holds one from a newer palette.
 *
 * The palette names are what the document stores — `white`, not `#FFFFFF` — so a later story that
 * changes what `white` looks like changes every shape ever drawn, and nothing stores a colour that a
 * person never chose. A value that is not a name is passed straight through, which is what lets a
 * document written by a client with a bigger palette still be drawn here.
 */
export const shapeFillColor = (fill: string): string =>
  (SHAPE_FILL_COLORS as Record<string, string>)[fill] ?? fill;

/** The colour to draw an outline with, same rule as the fill. */
export const shapeStrokeColor = (stroke: string): string =>
  (SHAPE_STROKE_COLORS as Record<string, string>)[stroke] ?? stroke;

/** A fill name of the palette this build draws, or one somebody else invented. */
export const isFillColor = (value: unknown): value is FillColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);

/** An outline name of the palette this build draws, or one somebody else invented. */
export const isStrokeColor = (value: unknown): value is StrokeColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => {
  if (typeof doc?.getMap !== 'function') {
    throw new TypeError('a Y.Doc is required');
  }
  initDoc(doc);
  return doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;
};

/**
 * The entry, and only a shape's entry: a stale id, an entry that is not a map and the id of an object
 * of another type all read as "no such shape", which is what keeps a stale selection — or a sticky note
 * that happens to share the moment — from being written through the shape functions.
 */
function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map && value.get('type') === SHAPE_OBJECT_TYPE ? value : undefined;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const numberOr = (value: unknown, fallback: number): number => (finite(value) ? value : fallback);

/** The top of the stack, over every object of every type. */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  objectsOf(doc).forEach((value) => {
    if (value instanceof Y.Map) top = Math.max(top, numberOr(value.get('z'), 0));
  });
  return top;
}

/**
 * The box a shape is drawn in: the rectangle it was dragged out, or a standard square around the point
 * that was clicked. Nothing is drawn and nothing is written when the answer is null.
 *
 * A drag worth the name is at least {@link SHAPE_MIN_SIZE_WORLD} in *both* directions — exactly that is
 * kept as drawn, one unit less and it is a click, which gets {@link SHAPE_DEFAULT_SIZE_WORLD} on both
 * sides centred on where the pointer went down. Shift (`square`) takes both sides to the larger of the
 * two dragged dimensions from the rectangle's origin, which is what a preview that squares while it is
 * dragged and a shape that arrives squared have to agree on.
 *
 * A rectangle of numbers that are not numbers is refused rather than repaired: the caller measured
 * something that does not exist, and a shape built on that would be a shape nobody chose. So is a click
 * with nowhere on the board to have been.
 *
 * Deciding whether a drag was a drag at all is the tool's job (it watched the pointer); this is the
 * model's last word on what the box it is handed means.
 */
export function shapeRect(
  rect: Rect | null | undefined,
  at: Point | null | undefined,
  square = false,
): Rect | null {
  const point = finite(at?.x) && finite(at?.y) ? { x: at.x, y: at.y } : null;

  if (rect === null || rect === undefined) {
    return point === null ? null : centered(point);
  }
  if (!finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) return null;

  // Shift: the larger of the two dimensions on both axes, from the corner the drag started at. The
  // tool anchors that corner to where the pointer went down, whichever way it was dragged; a rectangle
  // that arrives already squared — which is what the tool sends — is not changed by this.
  const side = square ? Math.max(Math.abs(rect.width), Math.abs(rect.height)) : null;
  const width = side ?? Math.abs(rect.width);
  const height = side ?? Math.abs(rect.height);

  // Too small to be a drag, in either direction, is a click — and a click needs somewhere to have
  // been. A rectangle that is a rectangle needs nothing else, so it is kept even by a caller that has
  // no point to offer.
  if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) {
    return point === null ? null : centered(point);
  }

  // A negative dimension is the drag going left or up, so the corner it was anchored at is the right
  // or bottom one; a positive one is the top-left. Shift keeps that corner where it is and grows the
  // other way, which is what a drag that squares while it is dragged looks like from the pointer's
  // side of things.
  const westward = rect.width < 0;
  const northward = rect.height < 0;
  return {
    x: westward ? rect.x - width : rect.x,
    y: northward ? rect.y - height : rect.y,
    width,
    height,
  };
}

/** The standard shape, centred on a point. */
const centered = (at: Point): Rect => ({
  x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
  y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
  width: SHAPE_DEFAULT_SIZE_WORLD,
  height: SHAPE_DEFAULT_SIZE_WORLD,
});

/** What a new shape is asked for. */
export interface CreateShapeInput {
  /** Which of the three to draw. An unknown kind writes nothing. */
  kind?: ShapeKind;
  /** The rectangle it was dragged out; `null` is a click, which gets the standard size. */
  rect?: Rect | null;
  /** Where the pointer went down, which is the centre of a shape that was clicked rather than dragged. */
  at?: Point | null;
  /** Shift: both sides the larger of the two dragged dimensions. */
  square?: boolean;
  /** Fill name (or colour). Defaults to the palette's default. */
  fill?: string;
  /** Outline name (or colour). Defaults to the palette's default. */
  stroke?: string;
  /** The label, if somebody had already typed it. Longer than the limit is cut to it. */
  label?: string;
  /** Who made it. */
  createdBy?: string;
}

/**
 * Writes a new shape (world units) and returns its id, or null when nothing was written.
 *
 * Nothing is written — and in particular no transaction is opened — for a kind this build cannot draw,
 * a rectangle whose numbers are not numbers, or a click with no point to click on: an undo stack full of
 * shapes that were never made is the thing this has to be right about.
 *
 * It returns the id rather than nothing because the interface has to do two things with a shape the
 * moment it is made — select it, and be able to undo it — and both are about an id. Type, kind, fill,
 * stroke, size and label are all written by the one transaction that made it (TC-01).
 */
export function createShape(doc: Y.Doc, input: CreateShapeInput = {}, by = ''): string | null {
  const kind = isShapeKind(input.kind) ? input.kind : null;
  if (kind === null) return null; // a kind nobody can draw is not a shape to be written and deleted again
  const box = shapeRect(input.rect ?? null, input.at ?? null, input.square === true);
  if (box === null) return null;

  const objects = objectsOf(doc);
  const id = crypto.randomUUID();
  const map = new Y.Map<unknown>();
  const ytext = new Y.Text();
  const createdAt = Date.now();
  const author = typeof input.createdBy === 'string' && input.createdBy.length > 0 ? input.createdBy : by;
  const fill = isFillColor(input.fill) ? input.fill : DEFAULT_SHAPE_FILL;
  const stroke = isStrokeColor(input.stroke) ? input.stroke : DEFAULT_SHAPE_STROKE;
  // A label handed over already too long is cut here, rather than written and then argued with by the
  // observer that watches the length: the limit says the extra characters are never added.
  const label = typeof input.label === 'string' ? input.label.slice(0, SHAPE_LABEL_MAX_CHARS) : '';

  doc.transact(() => {
    if (label.length > 0) ytext.insert(0, label);
    map.set('type', SHAPE_OBJECT_TYPE);
    map.set('kind', kind);
    map.set('x', box.x);
    map.set('y', box.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('z', maxZ(doc) + 1);
    map.set('createdAt', createdAt);
    map.set('createdBy', author);
    map.set('text', ytext);
    map.set('fill', fill);
    map.set('stroke', stroke);
    map.set('strokeWidth', SHAPE_STROKE_WIDTH_WORLD);
    objects.set(id, map);
    // The limit starts watching from the moment the label exists, so that the first keystroke after
    // this one is policed too — whoever makes it.
    guardShapeLabel(ytext);
  }, LOCAL_ORIGIN);
  return id;
}

/** What the interface may change about a shape's colours, in one step. */
export interface ShapeStylePatch {
  /** What to fill it with: a name from {@link SHAPE_FILL_COLORS}. */
  fill?: string;
  /** What to draw its outline in: a name from {@link SHAPE_STROKE_COLORS}. */
  stroke?: string;
}

/**
 * Changes the colours of one shape, or of all the shapes of a selection.
 *
 * One transaction for the whole list, which is what makes "colour five shapes with one button" one step
 * of the history rather than five. Shapes are the only objects it writes: a stale id, or the id of a
 * sticky note that is in the selection as well, is passed over — the toolbar colours what it drew, and a
 * note has its own palette for a reason.
 *
 * The colours are checked against the palettes before anything is written, and the whole call is refused
 * if one of them is not a colour this board knows: half a patch — a fill applied and an outline
 * quietly dropped — is a shape that looks like a mistake. A document that already holds a colour from a
 * bigger palette is still drawn (see {@link shapeFillColor}); it is only this board's own writes that
 * hold to its own palette.
 *
 * Returns false when there was nothing to write, which is how the caller avoids opening an undo step
 * that undoes nothing.
 */
export function setShapeStyle(
  doc: Y.Doc,
  ids: string | readonly string[],
  patch: ShapeStylePatch,
): boolean {
  if (patch.fill !== undefined && !isFillColor(patch.fill)) return false;
  if (patch.stroke !== undefined && !isStrokeColor(patch.stroke)) return false;

  const wanted = typeof ids === 'string' ? [ids] : Array.from(ids);
  const entries: { entry: Y.Map<unknown>; fill?: string; stroke?: string }[] = [];
  const seen = new Set<string>();
  for (const id of wanted) {
    if (seen.has(id)) continue;
    const entry = entryOf(doc, id);
    if (!entry) continue;
    const change = differs(entry, patch);
    if (change === null) continue;
    seen.add(id);
    entries.push(change);
  }
  if (entries.length === 0) return false;
  doc.transact(() => {
    for (const { entry, fill, stroke } of entries) {
      if (fill !== undefined) entry.set('fill', fill);
      if (stroke !== undefined) entry.set('stroke', stroke);
    }
  }, LOCAL_ORIGIN);
  return true;
}

/** The patch this entry actually needs, or nothing when it already looks like that. */
function differs(
  entry: Y.Map<unknown>,
  patch: ShapeStylePatch,
): { entry: Y.Map<unknown>; fill?: string; stroke?: string } | null {
  const fill = typeof patch.fill === 'string' && entry.get('fill') !== patch.fill ? patch.fill : undefined;
  const stroke =
    typeof patch.stroke === 'string' && entry.get('stroke') !== patch.stroke ? patch.stroke : undefined;
  if (fill === undefined && stroke === undefined) return null;
  return { entry, ...(fill === undefined ? {} : { fill }), ...(stroke === undefined ? {} : { stroke }) };
}

/* ------------------------------------------------------------------ the label, and how long it may get */

/** The labels this document is already watching. A `Y.Text` is only ever guarded once. */
const guardedLabels = new WeakSet<Y.Text>();

/** A label that is being shortened right now, so that shortening it is not itself a write to police. */
let policing = false;

/**
 * The label to type into, or nothing when there is no such shape.
 *
 * Asking for the label is also what starts the length limit watching it — which is why there is no
 * separate "watch this label" call for the interface to forget: the editor is the only thing that types
 * into a label, and it always asks for it first. A document that arrives with a label longer than the
 * limit keeps it, because the limit is only ever applied to what this board writes itself.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const ytext: unknown = entryOf(doc, id)?.get('text');
  if (!(ytext instanceof Y.Text)) return undefined;
  guardShapeLabel(ytext);
  return ytext;
}

/** The label of a shape entry, watching it for length from now on. Nothing when the entry has none. */
export function guardShapeLabel(ytext: unknown): Y.Text | null {
  if (!(ytext instanceof Y.Text)) return null;
  if (guardedLabels.has(ytext)) return ytext;
  guardedLabels.add(ytext);

  ytext.observe((event: Y.YTextEvent, transaction: Y.Transaction) => {
    // Somebody else's write, arriving over the network: it says what it says and this client does not
    // edit other people's words down to fit its own idea of a good label (TC-06). What counts as
    // somebody else's is the transaction's origin — this board's own writes carry `LOCAL_ORIGIN`, a
    // keystroke typed through any local route carries nothing at all, and an update that came in from
    // the room carries the bytes it arrived as.
    if (!isLocalWrite(transaction)) return;
    // The write that shortened the label is this guard's own work: policing it again would be an
    // argument with itself.
    if (policing) return;
    shortenToLimit(ytext, event);
  });
  return ytext;
}

/** This document, this person, this keystroke. */
function isLocalWrite(transaction: Y.Transaction): boolean {
  const origin = transaction.origin;
  return origin === null || origin === undefined || origin === LOCAL_ORIGIN;
}

/**
 * Takes a label that has grown past the limit back to the limit.
 *
 * The characters past it are not added, which is a different thing from the whole write being refused:
 * a person who pastes 600 characters into a label gets 500 of them and a label they can carry on typing
 * in. This is the backstop, not the enforcement point: the editor clamps what is typed before it writes
 * it (see `TextEditor`'s `maxChars`), so an ordinary burst of typing is one transaction and never gets
 * here. What does get here is a write that came by some other route — and because a shared type's
 * observers only run once the transaction they are policing has closed, that one takes two updates: the
 * write, and the cut.
 *
 * Only writes that *add* are counted, and only writes that were the ones to cross the line. A delete is
 * somebody deciding to write less, and a label that a document was already holding too long is not this
 * keystroke's fault — the characters are not there to be taken back.
 */
function shortenToLimit(ytext: Y.Text, event: Y.YTextEvent): void {
  let added = 0;
  let removed = 0;
  for (const operation of event.delta) {
    if (operation.insert !== undefined) {
      added += typeof operation.insert === 'string' ? operation.insert.length : 1;
      continue;
    }
    if (operation.delete !== undefined) removed += operation.delete;
  }
  // How long the label was before this write, which is the only length this write can be held to. A
  // label that a document was already holding past the limit is not made longer by the next keystroke
  // being refused; it is somebody else's length, and the characters to give up are not this person's.
  // One that was exactly full, on the other hand, is not this person's to grow.
  const before = ytext.length - added + removed;
  const excess = ytext.length - SHAPE_LABEL_MAX_CHARS;
  if (added === 0 || before > SHAPE_LABEL_MAX_CHARS || excess <= 0) return;

  policing = true;
  try {
    ytext.delete(SHAPE_LABEL_MAX_CHARS, excess);
  } finally {
    policing = false;
  }
}

/** How many characters this label may hold. Read from the config so nothing else has to know it. */
export const SHAPE_LABEL_LIMIT = SHAPE_LABEL_MAX_CHARS;

/**
 * Removes the shape when its label is empty.
 *
 * This is *not* the text object's rule: a shape with nothing written on it is a shape, and a shape that
 * had a label and lost it keeps its place on the board. It is here for the one case the PRD does spell
 * out — a shape dragged out and then decided against, which is deleted the way anything else is — and
 * it is a separate call precisely because the interface has to be able to *not* do it.
 */
export function deleteShapeIfEmptyLabel(doc: Y.Doc, id: string): boolean {
  const ytext: unknown = entryOf(doc, id)?.get('text');
  if (!(ytext instanceof Y.Text) || ytext.length > 0) return false;
  return deleteObjects(doc, [id]) > 0;
}
