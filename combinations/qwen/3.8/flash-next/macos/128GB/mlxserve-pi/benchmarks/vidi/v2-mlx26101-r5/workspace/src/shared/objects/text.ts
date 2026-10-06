/**
 * The text object: its schema and every mutation the interface can perform on it (story 9).
 *
 * A text object is free text written anywhere on the board. It is an entry in the same `objects` map
 * every other type uses — so the board model lists it, select-all takes it, one delete removes it and
 * the live room carries it — plus three fields of its own:
 *
 * - `text`: a `Y.Text`, CRDT text like a sticky note's, so two people can type in one text object and
 *   both keep their characters.
 * - `size`: one of the four names the product uses (`S`, `M`, `L`, `XL`). The font size is looked up
 *   from `TEXT_SIZES`; nothing stores a pixel size, so an old document and a new client agree on what
 *   "L" means.
 * - `widthMode`: `auto`, the box wide enough for its longest line up to `TEXT_MAX_AUTO_WIDTH_WORLD`;
 *   or `fixed`, a width the person set with a side handle and which remeasuring keeps.
 *
 * The box (`width`, `height`) is stored like every other type's, so hit-testing and selection need no
 * special case — but a text object never keeps a box that disagrees with its content: the client that
 * changed the text measures it and writes the box back with `setTextBox`. Height is content's alone
 * (TC-24); a side handle sets the width and the height follows.
 *
 * Every write goes through `doc.transact(fn, LOCAL_ORIGIN)`, like the sticky-note functions: origin is
 * how the board tells its own work from somebody else's, and the one constant that is not a
 * person-and-a-moment string is the local origin.
 *
 * These functions do **not** open an undo step: like `resizeObjects`, they are the thing that goes
 * *inside* a step, and the interface opens the step around them (see `src/client/board/undo.ts`).
 */

import * as Y from 'yjs';

import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import {
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

export const TEXT_OBJECT_TYPE = 'text';

/**
 * The size preset names, re-exported beside {@link TextSnapshot} so a file that reads a text object
 * needs one import. The names themselves live with the sizes in `config.ts`.
 */
export type { TextSize } from '../config';

/** One free-text object, as rendered by the client. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  /** The characters, exactly as the shared document holds them. */
  text: string;
  /** Which of the four presets the text is drawn at. */
  size: TextSize;
  /** Whether the box grew to its content or the person set its width. */
  widthMode: 'auto' | 'fixed';
}

/** The object is one of ours. */
export const isTextSnapshot = (object: ObjectSnapshot): object is TextSnapshot =>
  object.type === TEXT_OBJECT_TYPE;

/** A size the product has, or a size a document made up. */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

/** The size to draw at when a document holds one this client does not know. */
const sizeOrDefault = (value: unknown): TextSize => (isTextSize(value) ? value : DEFAULT_TEXT_SIZE);

/** The width mode to draw with when a document holds one this client does not know. */
const widthModeOrDefault = (value: unknown): 'auto' | 'fixed' =>
  value === 'fixed' ? 'fixed' : 'auto';

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => {
  if (typeof doc?.getMap !== 'function') {
    throw new TypeError('a Y.Doc is required');
  }
  initDoc(doc);
  return doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;
};

/**
 * The entry, and only a text object's entry: a stale id, an entry that is not a map, and the id of an
 * object of another type all read as "no such text object", which is what keeps a stale selection (or
 * a sticky note) from being written through the text functions.
 */
function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const value: unknown = objectsOf(doc).get(id);
  return value instanceof Y.Map && value.get('type') === TEXT_OBJECT_TYPE ? value : undefined;
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

/** One line of text, as high as the font it is drawn in. */
const lineHeight = (size: TextSize): number => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

/**
 * How wide an average glyph is, as a fraction of the font size. This is the guess the board falls back
 * on when a browser cannot measure anything at all (no 2D drawing context), and the guess a new text
 * object's first box is built from — one number, so the two never disagree.
 */
export const TEXT_GLYPH_WIDTH_RATIO = 0.5;

/**
 * The box a text object starts life with, before anything has been measured. It only has to exist —
 * bounds are what make an object selectable — and the client that renders it measures the real box and
 * writes it back. A zero-area box would be a box nothing can be selected by.
 */
export function estimatedTextBox(text: string, size: TextSize): { width: number; height: number } {
  const lines = text.length === 0 ? [''] : text.split('\n');
  const width = Math.max(1, ...lines.map((line) => line.length * TEXT_SIZES[size] * TEXT_GLYPH_WIDTH_RATIO));
  return { width, height: lines.length * lineHeight(size) };
}

/**
 * Writes a new text object at `at` (world units). Returns its id, or null when the position is not a
 * place. The object is empty when it is made — the product's rule is that an empty text object does
 * not stay, so the caller is expected to open the editor and, if nothing is typed, to call
 * `deleteIfEmpty`.
 *
 * The size is `DEFAULT_TEXT_SIZE`, the width mode `auto`, and the box an estimate, so the object has
 * bounds before the first measurement.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (typeof at !== 'object' || at === null || !finite(at.x) || !finite(at.y)) return null;
  const objects = objectsOf(doc);
  const id = crypto.randomUUID();
  const map = new Y.Map<unknown>();
  const ytext = new Y.Text();
  const size = DEFAULT_TEXT_SIZE;
  const box = estimatedTextBox('', size);
  const createdAt = Date.now();
  const author = typeof createdBy === 'string' ? createdBy : '';

  doc.transact(() => {
    map.set('type', TEXT_OBJECT_TYPE);
    map.set('x', at.x);
    map.set('y', at.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('z', maxZ(doc) + 1);
    map.set('createdAt', createdAt);
    map.set('createdBy', author);
    map.set('text', ytext);
    map.set('size', size);
    map.set('widthMode', 'auto');
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** The `Y.Text` to type into, or nothing when there is no such text object. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const ytext: unknown = entryOf(doc, id)?.get('text');
  return ytext instanceof Y.Text ? ytext : undefined;
}

/** The size to draw at: the one stored, or the default when the document holds one from the future. */
export function getTextSize(doc: Y.Doc, id: string): TextSize | undefined {
  const map = entryOf(doc, id);
  return map ? sizeOrDefault(map.get('size')) : undefined;
}

/** Whether the box follows its content or holds a width the person set. */
export function getTextWidthMode(doc: Y.Doc, id: string): 'auto' | 'fixed' | undefined {
  const map = entryOf(doc, id);
  return map ? widthModeOrDefault(map.get('widthMode')) : undefined;
}

/**
 * The width the document holds for a text object, or nothing when it holds none that counts.
 *
 * This is the width a fixed-width object wraps inside, and the only reason the box sync asks the
 * document a question instead of being told: the person may have dragged a side handle between two
 * keystrokes, and the measurement has to be taken from what the document says now.
 */
export function getTextWidth(doc: Y.Doc, id: string): number | undefined {
  const width: unknown = entryOf(doc, id)?.get('width');
  return finite(width) && width > 0 ? width : undefined;
}

/**
 * Sets the size of a text object by its product name. An unknown name is no change at all — the model
 * refuses rather than drawing something at a size nobody chose.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  const map = entryOf(doc, id);
  if (!map || !isTextSize(size) || map.get('size') === size) return false;
  doc.transact(() => {
    map.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets the width of a text object by hand, which is what its two side handles do: the width is the
 * person's, and stays theirs until they delete the object. A width narrower than `TEXT_MIN_WIDTH_WORLD`
 * is asked for by dragging the handle across itself; it stops at the minimum, and so does the `x` of a
 * west-handle drag, which is the caller's business (`moveObjects`).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  const map = entryOf(doc, id);
  if (!map || !finite(width)) return false;
  const wanted = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (map.get('widthMode') === 'fixed' && map.get('width') === wanted) return false;
  doc.transact(() => {
    map.set('widthMode', 'fixed');
    map.set('width', wanted);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Writes the box the measurement came up with. Nothing in here knows anything about text: it writes
 * two numbers, and only when they differ from what the document already says — which is how a
 * remeasure that changes nothing leaves nothing in the shared document and nothing in the undo stack.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const map = entryOf(doc, id);
  if (!map) return false;
  const { width, height } = box ?? { width: NaN, height: NaN };
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return false;
  if (map.get('width') === width && map.get('height') === height) return false;
  doc.transact(() => {
    map.set('width', width);
    map.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/** True when the text object holds no characters at all. A space is a character. */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext !== undefined && ytext.toString().length === 0;
}

/**
 * Removes the text object when its text is empty. The product's rule is that a text object nobody
 * typed into does not stay on the board, and it is checked once, when the editor closes — because a
 * text object that had characters and lost them to a backspace has already passed that moment and
 * keeps its place, exactly like every other type (TC-29).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}
