/**
 * Text objects: the schema and every mutation of it.
 *
 * This is the second object type on the board, and it is written to the same `objects` map as a sticky
 * note with the same rules — one `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation, errors as
 * values rather than exceptions, no write that would change nothing. What belongs to text alone
 * (`size`, `widthMode`, `createdBy`, and a `width`/`height` that follow the words rather than a drag) is
 * in this file, which is what lets `board-model.ts` go on knowing nothing about types: it hands out
 * `ObjectSnapshot`s, and a type's own fields are read by the code that cares about that type.
 *
 * **Why the box is stored.** Selection bounds, the marquee and anything that exports a board need to know
 * how much room a piece of text takes, and they must not have to measure it — not because measuring is
 * expensive, but because five clients with five different fonts would then store five different answers
 * to one question and disagree about where things are. So the box is written down by whoever changed the
 * text, once, and everybody else draws the box they were given (see `textLayout.ts`).
 *
 * **What "empty" means.** Zero characters. Spaces and newlines are text: a person who typed a space and
 * left it has put something on the board, and an object that was written to is not removed because a
 * count of letters came out low. Only text that never got any characters at all is cleared away, which is
 * the difference between an abandoned "click the board and press Escape" and a note that says something
 * quietly.
 */
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  registerKnownObjectType,
} from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  isTextSize,
} from '../config';
import type { TextSize } from '../config';
import type { Point } from '../geometry';
import { finitePoint } from '../geometry';

/** Object discriminator stored on every text object. */
export const TEXT_OBJECT_TYPE = 'text';

/**
 * How a text object's width is decided.
 *
 * `auto` means the box is as wide as its longest line, up to `TEXT_MAX_AUTO_WIDTH_WORLD`, and narrows
 * again when the line does; `fixed` means a person dragged it to a width and the words wrap inside that.
 * A drag of a side handle is the only way in, and there is no way back out again in this story — a box
 * that went back to auto on the next keystroke would be a width the person just chose being taken away
 * from them.
 */
export type TextWidthMode = 'auto' | 'fixed';

const OBJECTS_KEY = 'objects';
const AUTO_WIDTH_MODE: TextWidthMode = 'auto';

/** A text object, as the document holds it. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  /** The words. Always present: a text object with no text field has empty text, which is what `text: ''` says. */
  text: string;
  /** One of the four sizes, never a raw number: the number is looked up from the setting on every draw. */
  size: TextSize;
  widthMode: TextWidthMode;
  /** Who made it. Anonymised in this build (see `Board`); story 6 turns it into a person. */
  createdBy: string;
}

/** The box a text object stores, in world units. */
export interface TextBox {
  width: number;
  height: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/**
 * Whether this snapshot carries the fields only a text object has, so they can be read off it.
 *
 * The check is structural rather than a comparison of `type`, because there are two ways to be a text
 * object as far as this codebase is concerned: read by `readText`, which gives the words, the size and the
 * width mode; and read by the generic `snapshot`, which gives position, stacking and box and nothing else —
 * `board-model.ts` does not know what any type's own fields are. Both have `type: 'text'`, and only one of
 * them can answer "what size is this". A guard that asked only about `type` would promise a `size` that is
 * `undefined`, which is the kind of lie that turns into a heading drawn at "undefinedpx".
 */
export function isTextSnapshot(object: ObjectSnapshot | undefined | null): object is TextSnapshot {
  if (object === undefined || object === null || object.type !== TEXT_OBJECT_TYPE) return false;
  const withFields = object as Partial<TextSnapshot>;
  return (
    typeof withFields.text === 'string' &&
    isTextSize(withFields.size) &&
    (withFields.widthMode === 'auto' || withFields.widthMode === 'fixed')
  );
}

/** Any object by id, whatever its type, as long as it says what it is. */
function objectOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const object = objects.get(id);
  if (!(object instanceof Y.Map) || typeof object.get('type') !== 'string') return undefined;
  return object;
}

/** A text object by id, or undefined when there is no object of that id or it is some other type. */
function textOf(objects: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  const object = objectOf(objects, id);
  return object?.get('type') === TEXT_OBJECT_TYPE ? object : undefined;
}

function ytextOf(object: Y.Map<unknown>): Y.Text | undefined {
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
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

/** The height of one line at this size, in world units. Exported because the editor needs it too. */
export function textLineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

/** The size a stored key means, or the size a text object is born with when the key is not one of ours. */
export function textSizeOf(key: unknown): TextSize {
  return isTextSize(key) ? key : DEFAULT_TEXT_SIZE;
}

/**
 * One text object, read straight from the document.
 *
 * This is how a text component gets at the fields the generic snapshot does not carry: the board hands out
 * `ObjectSnapshot`s, and only the code that draws text needs to know about sizes and width modes. A
 * document that stores something unusable is read as the nearest usable thing rather than as nothing —
 * text written by a later story, with a size key this build has never heard of, is still text that a
 * person wrote, and hiding it would be worse than drawing it at the default size.
 */
export function readText(doc: Y.Doc, id: string): TextSnapshot | null {
  const object = textOf(objectsOf(doc), id);
  if (object === undefined) return null;
  return readTextObject(id, object);
}

/** Read one stored text object. Returns null for an object that is not a usable text object at all. */
export function readTextObject(id: string, object: Y.Map<unknown>): TextSnapshot | null {
  if (object.get('type') !== TEXT_OBJECT_TYPE) return null;
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  if (!finite(x) || !finite(y) || !finite(z)) return null;

  const text = ytextOf(object);
  const width = object.get('width');
  const height = object.get('height');
  const createdAt = object.get('createdAt');
  const widthMode = object.get('widthMode');
  const createdBy = object.get('createdBy');

  return Object.freeze({
    id,
    type: 'text' as const,
    x,
    y,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    // An object with no stored box has no size, which is not the same as a sticky note's default: text
    // that was never measured is drawn at the narrowest box the board accepts rather than at a note's 200
    // units, because a line of text that is 90 units wide does not own a 200-unit field.
    width: finite(width) && width > 0 ? width : TEXT_MIN_WIDTH_WORLD,
    height: finite(height) && height > 0 ? height : textLineHeight(textSizeOf(object.get('size'))),
    text: text ? text.toString() : '',
    size: textSizeOf(object.get('size')),
    widthMode: widthMode === 'fixed' ? 'fixed' : AUTO_WIDTH_MODE,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
  });
}

/** Every text object on the board, in stacking order — the same order the board draws them in. */
export function textSnapshots(doc: Y.Doc): readonly TextSnapshot[] {
  const texts: TextSnapshot[] = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map)) continue;
    const read = readTextObject(id, object);
    if (read !== null) texts.push(read);
  }
  texts.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(texts);
}

/**
 * The box a text object is drawn at: what `layoutText` computes and `setTextBox` writes.
 *
 * A text object with no stored box is not sizeless — it is one line wide at the narrowest width the board
 * accepts, which is what an empty text is before anything has been measured.
 */
export function getTextBox(doc: Y.Doc, id: string): TextBox | null {
  const read = readText(doc, id);
  return read === null ? null : { width: read.width, height: read.height };
}

/** The size key of a text object, or null when there is no such text object. */
export function getTextSize(doc: Y.Doc, id: string): TextSize | null {
  const read = readText(doc, id);
  return read === null ? null : read.size;
}

/** How a text object's width is decided, or null when there is no such text object. */
export function getTextWidthMode(doc: Y.Doc, id: string): TextWidthMode | null {
  const read = readText(doc, id);
  return read === null ? null : read.widthMode;
}

/**
 * Put a piece of text on the board with its **top-left corner** at `at`, on top of everything, in one
 * transaction, and return its id.
 *
 * Unlike a sticky note, which is centred on the point it was created at, text starts where it was put: a
 * person who clicks at the place where a heading should begin expects the first letter there, not half a
 * heading further along.
 *
 * The box is an estimate — the narrowest box the board accepts, one line tall — because nothing has been
 * measured yet and an object with no size at all cannot be selected, marqueeed or dragged. The first
 * keystroke replaces it with a measurement (see `useTextBoxSync`).
 *
 * A point that is not a real place on the board creates nothing and opens no transaction: a text object
 * at `NaN` would be on the board, taking a `z`, unreachable by any pointer.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!finitePoint(at)) return null;

  const objects = objectsOf(doc);
  const id = newId();
  const object = new Y.Map<unknown>();
  const z = highestZ(objects) + 1;

  doc.transact(() => {
    object.set('type', TEXT_OBJECT_TYPE);
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', TEXT_MIN_WIDTH_WORLD);
    object.set('height', textLineHeight(DEFAULT_TEXT_SIZE));
    object.set('z', z);
    object.set('createdAt', Date.now());
    object.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    object.set('text', new Y.Text(''));
    object.set('size', DEFAULT_TEXT_SIZE);
    object.set('widthMode', AUTO_WIDTH_MODE);
    objects.set(id, object);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Choose one of the four sizes.
 *
 * The size is stored as the *key*, so what a board holds is "XL" rather than "56" and the numbers can be
 * retuned without rewriting anybody's board. An unknown key is refused rather than guessed at: a name that
 * is not one of ours came from somewhere else, and writing a size nobody asked for would be a change to
 * somebody's heading that they did not make.
 *
 * This changes the letters' size and nothing else — the box is the same size it was, because a bigger
 * piece of text in an unchanged box is exactly what the caller has to go and measure.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;

  const object = textOf(objectsOf(doc), id);
  if (object === undefined || object.get('size') === size) return false;

  doc.transact(() => {
    object.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give a text object a width of somebody's choosing, and wrap its words inside it.
 *
 * Setting a width *is* choosing fixed-width mode: nobody drags the side of a piece of text in order to
 * have it snap back to the width of its longest line on the next keystroke. The width is clamped into the
 * range the board accepts rather than refused, because a drag is a continuous thing — a pointer that goes
 * past the narrowest width still means "this wide, or as near as the board allows", and a handle that
 * stops responding half way through a drag is worse than one that stops moving the box.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;

  const object = textOf(objectsOf(doc), id);
  if (object === undefined) return false;

  const clamped = clamp(width, TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD);
  const mode = object.get('widthMode');
  const stored = object.get('width');
  if (mode === 'fixed' && finite(stored) && stored === clamped) return false;

  doc.transact(() => {
    object.set('widthMode', 'fixed');
    object.set('width', clamped);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box: how much room the words take.
 *
 * Only ever called after something *this client* changed (Key decision 1), which is why there is no
 * "remeasure everything" function here — a board whose five clients each re-measured every change would
 * write five times about one keystroke, and store five different answers.
 *
 * A box that is already the box is not written: a measurement that changes nothing must not cost a sync
 * message, and this is called on every keystroke.
 */
export function setTextBox(doc: Y.Doc, id: string, box: TextBox): boolean {
  if (!finite(box?.width) || !finite(box?.height) || box.width <= 0 || box.height <= 0) return false;

  const object = textOf(objectsOf(doc), id);
  if (object === undefined) return false;

  const width = clamp(box.width, TEXT_MIN_WIDTH_WORLD, MAX_OBJECT_SIZE_WORLD);
  const height = clamp(box.height, textLineHeight(textSizeOf(object.get('size'))), MAX_OBJECT_SIZE_WORLD);
  if (object.get('width') === width && object.get('height') === height) return false;

  doc.transact(() => {
    object.set('width', width);
    object.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The text itself, for typing into.
 *
 * An object whose text field is missing or of the wrong type — a document written by a story that stored
 * text some other way — is repaired in place, because the editor has to have something to write to and
 * there is nothing to preserve where there was nothing readable anyway. Returns undefined for an id that
 * is not a text object: a keystroke must never create an object.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = textOf(objectsOf(doc), id);
  if (object === undefined) return undefined;

  const text = ytextOf(object);
  if (text !== undefined) return text;

  const replacement = new Y.Text('');
  doc.transact(() => {
    object.set('text', replacement);
  }, LOCAL_ORIGIN);
  return replacement;
}

/** The text as it is written, or `''` for an id that is not a text object. */
export function getText(doc: Y.Doc, id: string): string {
  const object = textOf(objectsOf(doc), id);
  const text = object === undefined ? undefined : ytextOf(object);
  return text ? text.toString() : '';
}

/**
 * Whether this text holds no characters at all.
 *
 * Zero characters, and only that: `"  "` is text, `"\n"` is text, and both are things a person put on the
 * board. An id that is not a text object has no characters either, which is why the answer for a text
 * somebody else has just deleted is `true` — and why `deleteIfEmpty` is the safe thing to call when an
 * edit ends no matter what happened while it was open.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const object = textOf(objectsOf(doc), id);
  if (object === undefined) return true;
  const text = ytextOf(object);
  return text === undefined || text.length === 0;
}

/**
 * Take a text object off the board if, and only if, it never got any words.
 *
 * This is what an abandoned text is: the click that placed a caret and nothing else. It is one delete of
 * one object, in the same capture window as whatever else just happened, so one undo brings the text back
 * with its words. An object with characters in it is left alone, whoever is asking.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const object = textOf(objects, id);
  // No object at all is not a removal: there is nothing to delete, and saying otherwise would tell the
  // caller it had taken something off the board that had already gone.
  if (object === undefined) return false;
  const text = ytextOf(object);
  if (text !== undefined && text.length > 0) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `text-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

/**
 * Text announces itself to the board model, the way the client registry does for the types it draws.
 *
 * `board-model.ts` deliberately does not know what kinds of objects a board holds — it reports the types it
 * has been told about, and ignores the rest so a board written by a later story still loads. That means a
 * type that never introduces itself is invisible: not marqueed, not selectable, not in a snapshot, not
 * deletable by anyone but the code that made it. The client registry says it for the components; this says
 * it for the model, so a document, a test or a server that works with text objects without importing any
 * React still sees them. The call is idempotent, so doing it twice — which is what happens in the app — is
 * the same as doing it once.
 */
registerKnownObjectType(TEXT_OBJECT_TYPE);
