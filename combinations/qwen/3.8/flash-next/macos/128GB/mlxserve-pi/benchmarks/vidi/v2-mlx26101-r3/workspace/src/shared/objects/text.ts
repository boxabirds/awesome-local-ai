import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  isTextSize,
  isTextWidthMode,
  type TextSize,
  type TextWidthMode,
} from '../config';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  canReadObjectType,
  deleteObjects,
  registerObjectReader,
  type ObjectSnapshot,
  type TextSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

/**
 * Free text on the board (story 9): the schema, and every mutation of it.
 *
 * A text object is plain text with no background - a heading, a label, an annotation - and it is
 * an ordinary board object otherwise: it is moved, stacked, deleted and selected by story 7's
 * generic operations on `objects`, and its text is written with story 2's minimal `Y.Text` diffs.
 * Nothing in this file knows about pointers, selection or React; like the rest of `shared`, it is
 * the document's contract, which the Durable Object may one day validate.
 *
 * ```text
 * objects/<id>: Y.Map {
 *   type: 'text'
 *   x, y: number            // top-left, world units
 *   width, height: number   // world units; the box the text is drawn in
 *   text: Y.Text
 *   size: 'S' | 'M' | 'L' | 'XL'
 *   widthMode: 'auto' | 'fixed'
 *   z, createdAt, createdBy
 * }
 * ```
 *
 * The two fields a sticky note does not have say how the box is arrived at, and only `width` is
 * ever a person's decision: `widthMode: 'auto'` means "as wide as the longest line, up to the
 * product maximum", `'fixed'` means "the width the side handle was dragged to". Height is never
 * either, because height always follows the content - which is why a text object has no top or
 * bottom handle, and why the height written here is always measured by a client and never dragged.
 *
 * Every mutation is one `doc.transact(fn, LOCAL_ORIGIN)`, and a rejected one - stale id, unknown
 * size, non-finite number - returns before a transaction is opened, so it emits no update and
 * costs no sync traffic. This module never throws for user-driven input.
 */

/** The `type` discriminator of a text object. */
export const TEXT_TYPE = 'text';

// The model is allowed to read this type as soon as this module is loaded, which is the same
// one-place registration the client's object registry uses for the component that draws it. A
// client that never imports this file - an older build, say - skips text objects instead of
// failing on them, which is the compatibility the PRD asks for.
registerObjectReader(TEXT_TYPE);

/** The four size presets, in the order the toolbar shows them. */
export const TEXT_SIZE_ORDER: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

/** The size presets are guarded in `config`, next to the sizes themselves. */
export { isTextSize, isTextWidthMode } from '../config';

/**
 * A text object, as the board reads it. The snapshot type belongs to the board model, next to the
 * reader that fills it in; it is re-exported here so that the code which writes text objects can
 * be read alongside the shape it leaves behind.
 */
export type { TextSnapshot } from '../board-model';

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

/** A member of `objects` that is a text object this client can read. */
function textObject(objects: Y.Map<YObject>, id: string): YObject | null {
  const object = objects.get(id);
  if (object === undefined || !(object instanceof Y.Map) || object.get('type') !== TEXT_TYPE) {
    return null;
  }
  if (!canReadObjectType(TEXT_TYPE)) {
    return null;
  }
  return object;
}

function readZ(object: YObject): number {
  const z = object.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
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
 * Ids are `crypto.randomUUID()`, so text created offline by different peers (story 3) never
 * collides with a note or with each other. The fallback only runs where the Web Crypto UUID
 * helper is missing (the same rule as the board model's).
 */
function newId(): string {
  const cryptoObject: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

/**
 * The box an object that has never been measured gets: the narrowest legal width, and tall
 * enough for one line of the default size.
 *
 * A brand new object is empty, and an empty text has no width of its own - but an object with no
 * box cannot be selected, drawn or undone from, so it is given the smallest one the product
 * allows. The first keystroke measures it for real and writes the answer over it, in the same
 * undo step as the keystroke itself.
 */
function initialBox(): { width: number; height: number } {
  return {
    width: TEXT_MIN_WIDTH_WORLD,
    height: Math.round(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT),
  };
}

/**
 * Put a new text object on the board with its **top-left at `at`** - not centred on it, the way a
 * sticky note is: a heading is placed where the pointer was, and centring it would put the words
 * somewhere the person did not point at.
 *
 * It starts in the middle size, at auto width, with no characters in it, above every other object.
 * Whoever creates it is recorded as `createdBy`; there is no account system yet (story 6), so the
 * caller says who this client is, and a later story can pass the real identity without changing
 * the schema.
 *
 * @returns the new id, or `null` when the point was not a place on the board - and then nothing
 * was written at all.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (
    !Number.isFinite(at.x) ||
    !Number.isFinite(at.y) ||
    typeof createdBy !== 'string' ||
    createdBy === ''
  ) {
    return null;
  }
  const id = newId();
  const box = initialBox();
  doc.transact(() => {
    const objects = objectsOf(doc);
    const object = new Y.Map<unknown>();
    object.set('type', TEXT_TYPE);
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('text', new Y.Text());
    object.set('size', DEFAULT_TEXT_SIZE);
    object.set('widthMode', 'auto' satisfies TextWidthMode);
    object.set('z', maxZ(objects) + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', createdBy);
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change a text object's size, keeping its position and leaving its box to the caller: the box
 * has to be re-measured at the new font size, and measuring needs a browser.
 *
 * An unknown size name - `'XXL'`, a number, a field a peer wrote wrongly - is rejected rather
 * than rounded to the nearest one, because a size the product does not offer is not a size the
 * object may be stored as.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) {
    return false;
  }
  const object = textObject(objectsOf(doc), id);
  if (object === null || object.get('size') === size) {
    return false;
  }
  doc.transact(() => {
    object.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Give a text object a width a person chose by dragging a side handle, and say so by setting
 * `widthMode` to `fixed`: from here on its width no longer follows its longest line.
 *
 * The width is clamped, not rejected: a handle dragged past the narrow the product allows stops
 * there, and the drag still does what it was doing. The height is not touched - the caller
 * re-wraps the text at the new width and writes the height that comes out with
 * {@link setTextBox}, which is what keeps "height follows content" true at every write.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) {
    return false;
  }
  const object = textObject(objectsOf(doc), id);
  if (object === null) {
    return false;
  }
  const next = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (object.get('widthMode') === 'fixed' && object.get('width') === next) {
    return false;
  }
  doc.transact(() => {
    object.set('widthMode', 'fixed' satisfies TextWidthMode);
    object.set('width', next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store the box the text was measured in.
 *
 * The dimensions are kept in the document so that every client can place, select and marquee a
 * text object without measuring anything (Key decision 1 in the design); only the client that
 * made the change measures, and the write is skipped when the box already says what the
 * measurement came to, so a client that is only looking never writes.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const { width, height } = box;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }
  const object = textObject(objectsOf(doc), id);
  if (object === null || (object.get('width') === width && object.get('height') === height)) {
    return false;
  }
  doc.transact(() => {
    object.set('width', width);
    object.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The object's text as a `Y.Text`, so typing merges character-wise with other peers (story 3).
 * `undefined` for a stale id, and for an object that is not a text object at all.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = textObject(objectsOf(doc), id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Everything a text object's box is worked out from, read straight out of the document.
 *
 * The client measures the text and writes the result back, so the code that does it needs the
 * size, the width mode and the width that mode is holding - and needs them at the moment of the
 * change, not from the snapshot a component was handed a render ago. This reads all of it in one
 * go, and defaults a size or a mode the product does not know the same way the reader does, so a
 * measurement is never taken against a size the object is not drawn at.
 */
export interface TextFields {
  /** Where the object stands; its box starts at the position, as it does for every object. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: TextWidthMode;
  readonly width: number;
  readonly height: number;
}

export function getTextFields(doc: Y.Doc, id: string): TextFields | null {
  const object = textObject(objectsOf(doc), id);
  const content = object?.get('text');
  if (object === null || !(content instanceof Y.Text)) {
    return null;
  }
  const size = object.get('size');
  const widthMode = object.get('widthMode');
  return {
    x: readNumber(object.get('x')),
    y: readNumber(object.get('y')),
    text: content.toString(),
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: isTextWidthMode(widthMode) ? widthMode : 'auto',
    width: readNumber(object.get('width')),
    height: readNumber(object.get('height')),
  };
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Whether a text object holds no characters.
 *
 * Only *zero* characters counts as empty: text that is typed and then deleted is a mistake the
 * person wants gone, while a line someone deliberately left - spaces, a blank line between two
 * paragraphs - is text they put there. A stale id is not empty, it is absent: there is nothing
 * here whose text could be measured, which is what {@link deleteIfEmpty} reports as `false`.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = textObject(objectsOf(doc), id)?.get('text');
  return text instanceof Y.Text && text.length === 0;
}

/**
 * Remove a text object that is still empty, which is what ending an edit does to a text that was
 * clicked into and never typed in: an invisible object nobody can select is worse than no object.
 *
 * @returns `true` when an empty text object was deleted; `false` when it had text, or when there
 * is no such object (it was already gone, most likely deleted by somebody else while it was being
 * edited - which is not an error and is certainly not a reason to create one).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) {
    return false;
  }
  return deleteObjects(doc, [id]) > 0;
}

/** The object as a text object, or `null` when the snapshot is of something else. */
export function asTextSnapshot(object: ObjectSnapshot | undefined): TextSnapshot | null {
  if (object === undefined || object.type !== TEXT_TYPE) {
    return null;
  }
  return {
    ...object,
    type: TEXT_TYPE,
    size: isTextSize(object.size) ? object.size : DEFAULT_TEXT_SIZE,
    widthMode: isTextWidthMode(object.widthMode) ? object.widthMode : 'auto',
    createdBy: typeof object.createdBy === 'string' ? object.createdBy : undefined,
  };
}
