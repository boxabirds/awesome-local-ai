/**
 * The free text object (schema: `text.model`): what it stores, and the only ways to
 * change it.
 *
 * A text object is the board's plainest object — characters on the board with nothing
 * behind them — and it borrows everything it can: the common fields (`id`, `type`, `x`,
 * `y`, `width`, `height`, `z`) come from the shared model in `../board-model.ts`, the
 * one entry in the `objects` map, the same `createdBy` rule notes already use, and the
 * same `Y.Text` that lets two people type in one object at the same time (story 3).
 * What is new is three fields of its own:
 *
 *  - `size`: one of the four presets in `TEXT_SIZES`, not a free font size — four
 *    sizes a user can name is a design decision (story 9 `text.size`), and a size the
 *    build does not know is refused on write and reads back as `DEFAULT_TEXT_SIZE`;
 *  - `widthMode`: `auto` while the box follows the text, `fixed` once a side handle
 *    has been dragged to a width (story 9 `text.fixed_width`). Height is never stored
 *    as a user choice: it always follows the content;
 *  - `text`: the characters themselves, as a `Y.Text`.
 *
 * The stored `width`/`height` are a *measurement*, written back by the client that
 * changed the text (`src/client/objects/useTextBoxSync.ts`) and read by everyone else
 * to draw and to select. They are in the document rather than computed on screen so
 * that selection, marquee and resize — code that knows nothing about fonts — can ask
 * one question of any object: where is it.
 *
 * Two rules hold for every change here, and both are load-bearing for the sync layer:
 *
 *  - a bad input (a stale id, an unknown size, a `NaN`) returns `false` *before* a
 *    transaction opens, so a rejection costs no update and no sync traffic;
 *  - a change that would write what is already there writes nothing at all. The
 *    measured box is written on every keystroke, and most keystrokes do not change
 *    it — a remeasure that agrees with the document is not news to anybody.
 *
 * This module is shared with the board model (framework-free, DOM-free): the Worker
 * that syncs boards can import it. Importing it also declares the type to the shared
 * model, which is what lets `boardObjects` read a text object's own fields — that is
 * why `src/client/objects/index.ts` imports it, and any other build that must see
 * text objects has to as well.
 */

import * as Y from 'yjs';
import {
  createId,
  declareObjectType,
  deleteObjects,
  LOCAL_ORIGIN,
  maxZ,
  objectMap,
  type ObjectSnapshot
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize
} from '../config';


/** The object type name this module owns. */
export const TEXT_OBJECT_TYPE = 'text';

/** How a text box gets its width: following the text, or given by dragging a handle. */
export type TextWidthMode = 'auto' | 'fixed';

/** A text object, as the screen and the snapshot worker read it. */
export interface TextSnapshot extends ObjectSnapshot {
  /**
   * A text always carries its box: it is a measurement of the words, written by whoever
   * changed them, and it is what the selection, the marquee and the hit test are drawn
   * from. `ObjectSnapshot` leaves it optional for types it knows nothing about; a text has
   * one from the moment it is created.
   */
  readonly width: number;
  readonly height: number;
  /** The characters, joined into one string. Newlines are kept. */
  text: string;
  /** One of the four sizes. A stored size this build does not know reads as the default. */
  size: TextSize;
  /** `auto` until a side handle is dragged; then the width stays where it was put. */
  widthMode: TextWidthMode;
  /** When this text was made, in epoch milliseconds. 0 for a text that never said. */
  readonly createdAt: number;
}

/** Is `size` one of the four names this build can render? */
export function isTextSize(size: unknown): size is TextSize {
  return typeof size === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, size);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The text object's own reader: see `declareObjectType` in `../board-model.ts`. */
function readTextObject(object: Y.Map<unknown>, common: ObjectSnapshot): TextSnapshot | null {
  // A text object whose text is not a `Y.Text` cannot be typed into, so it is left
  // out of every snapshot rather than drawn as an empty box that ignores you.
  const text = object.get('text');
  if (!(text instanceof Y.Text)) return null;
  // A text written by a build that stored no box, or a box that is not a number, is drawn
  // as one empty line at the default size — which is what it is until somebody measures
  // it — rather than dropped, because the words in it are real.
  const width = isFiniteNumber(object.get('width')) ? (object.get('width') as number) : TEXT_MIN_WIDTH_WORLD;
  const height = isFiniteNumber(object.get('height'))
    ? (object.get('height') as number)
    : TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;
  const createdAt = object.get('createdAt');
  return {
    ...common,
    width,
    height,
    createdAt: isFiniteNumber(createdAt) ? (createdAt as number) : 0,
    text: text.toString(),
    size: isTextSize(object.get('size')) ? (object.get('size') as TextSize) : DEFAULT_TEXT_SIZE,
    widthMode: object.get('widthMode') === 'fixed' ? 'fixed' : 'auto'
  };
}

declareObjectType(TEXT_OBJECT_TYPE, readTextObject);

/** The objects map, typed the way the model uses it. */
function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** A text object's `Y.Map`, or undefined when the id is not a text object on this board. */
function textMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objectMap(doc, id);
  return object && object.get('type') === TEXT_OBJECT_TYPE ? object : undefined;
}

/**
 * Put a new, empty text on the board with its **top-left** corner at `at` — the point
 * that was clicked, so the first character appears under the cursor rather than a
 * click away from it — above every object already there, and return its id.
 *
 * It starts in `auto` width at the default size, holding an empty `Y.Text`. The box
 * is the size of one line of the default size at the narrowest width a text box may
 * have: the real box is measured as soon as there is something to measure, and until
 * then the object still has bounds to select, to draw a ring around and to hit.
 *
 * Returns `null` when `at` is not a point — no transaction, no update, nothing to
 * sync — which is why every caller can pass a screen-to-world conversion straight in.
 */
export function createText(doc: Y.Doc, at: { x: number; y: number }, createdBy?: string): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  let created: string | null = null;
  doc.transact(() => {
    const id = createId();
    const object = new Y.Map<unknown>();
    object.set('id', id);
    object.set('type', TEXT_OBJECT_TYPE);
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', TEXT_MIN_WIDTH_WORLD);
    object.set('height', TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    // Created on top: text is what you reach for, and a new object you cannot see is
    // the worst kind of success.
    object.set('z', maxZ(doc) + 1);
    object.set('size', DEFAULT_TEXT_SIZE);
    object.set('widthMode', 'auto');
    object.set('createdAt', Date.now());
    object.set('text', new Y.Text());
    if (typeof createdBy === 'string' && createdBy !== '') object.set('createdBy', createdBy);
    objectsOf(doc).set(id, object);
    created = id;
  }, LOCAL_ORIGIN);
  return created;
}

/**
 * Set the text's size to one of the four presets (`text.size`). The box is *not*
 * remeasured here: the caller remeasures through `useTextBoxSync`, so the same code
 * path — the one that measures with the real font — decides the new box whether the
 * size came from the toolbar, from a remote peer's toolbar, or from an undo.
 *
 * A size outside the preset list is rejected: the toolbar offers four sizes and a
 * fifth one is a bug somewhere else, not a state to store.
 */
export function setTextSize(doc: Y.Doc, id: string, size: TextSize | string): boolean {
  if (!isTextSize(size)) return false;
  const object = textMap(doc, id);
  if (!object || object.get('size') === size) return false;
  doc.transact(() => object.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * Give the text a width of the user's own (`text.fixed_width`): the box stops following
 * its content and lines wrap inside the width it was given.
 *
 * The width is clamped up to `TEXT_MIN_WIDTH_WORLD` — a box narrower than one word is
 * still a box the user can grab, and the drag that produces it should not have to know
 * where the limit is. Height keeps following the content, so a narrower box is a
 * taller one, and the remeasure that follows does that.
 *
 * `auto` is reached only by dragging a handle back to the content width (story 9 keeps
 * the rule to one direction: once you have chosen a width, the box keeps it).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const object = textMap(doc, id);
  if (!object) return false;
  const next = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (object.get('width') === next && object.get('widthMode') === 'fixed') return false;
  doc.transact(() => {
    object.set('width', next);
    object.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store a measured box (`text.auto_width`, `text.fixed_width`). This is the write the
 * measuring client makes about its own text — never a remote one, or five clients
 * would race to write the same two numbers and their fonts would disagree about the
 * answer.
 *
 * A box that differs from the stored one by nothing writes nothing, which is what
 * makes it safe to remeasure on every keystroke.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!box || !isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const object = textMap(doc, id);
  if (!object) return false;
  if (object.get('width') === box.width && object.get('height') === box.height) return false;
  doc.transact(() => {
    object.set('width', box.width);
    object.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The object's `Y.Text`, for typing into and for observing.
 *
 * This is the only shared value of a text object. The box, the size and the width mode
 * are metadata that can be overwritten wholesale; the text is the thing the user wrote,
 * and it is a `Y.Text` so that two people typing at once keep every character
 * (story 3, story 9 `text.concurrent`).
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = textMap(doc, id);
  if (!object) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The four fields a measurement needs: see `src/client/objects/textLayout.ts`. */
export interface TextFields {
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
  width: number;
}

/**
 * What the text looks like right now, as far as sizing it is concerned — without the
 * whole-board walk `boardObjects` would do for one object.
 *
 * Returns `null` for an id that is not a text object, which is the common case by the
 * time a measurement scheduled a microtask ago gets around to running: somebody else
 * deleted it.
 */
export function getTextFields(doc: Y.Doc, id: string): TextFields | null {
  const object = textMap(doc, id);
  if (!object) return null;
  const text = object.get('text');
  if (!(text instanceof Y.Text)) return null;
  return {
    text: text.toString(),
    size: isTextSize(object.get('size')) ? (object.get('size') as TextSize) : DEFAULT_TEXT_SIZE,
    widthMode: object.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    width: typeof object.get('width') === 'number' ? (object.get('width') as number) : TEXT_MIN_WIDTH_WORLD
  };
}

/**
 * Does this text hold no characters at all?
 *
 * Exactly zero characters — whitespace counts. A space is something the user typed, and
 * an object that silently deletes itself while somebody is typing a leading space is
 * worse than one that looks empty.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Remove the object if it holds nothing (`text.model: remove on empty`), and report
 * whether it went.
 *
 * Called when editing ends, which is the only moment at which an empty text is known
 * to be unwanted: an empty text is how text *begins*, and one created and never typed
 * in is the thing nobody meant to leave on the board. Origin `LOCAL_ORIGIN`, so it is
 * undone by a plain Ctrl+Z along with the typing that came before it (the undo manager
 * merges changes made within `UNDO_CAPTURE_TIMEOUT_MS` of each other, and one keystroke
 * earlier is always inside that window).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  deleteObjects(doc, [id]);
  return true;
}
