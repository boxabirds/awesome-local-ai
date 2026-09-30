// The text object's part of the board document (`text.model`).
//
// Story 9 adds the second kind of object, and it is the first one added purely
// *through* the registry story 7 left behind: `board-model` learns that a `text`
// object exists (and how small it may go) from this file, and every generic
// operation — select, move, nudge, delete, undo, share — is story 7's and
// story 8's unchanged, with nothing text-specific added to them (`text.consistent`).
//
// Schema of one text object (design.md, "Document schema addition"):
//   objects/<id>: Y.Map {
//     type: 'text', x, y, width, height, z, createdAt, createdBy,
//     text: Y.Text, size: TextSize, widthMode: 'auto' | 'fixed'
//   }
//
// `width` and `height` are *stored* rather than measured by whoever looks: five
// clients re-measuring the same string and each writing the result back would be
// five writes for one change. The client that made the change measures and writes
// the box in the same capture window (`useTextBoxSync`); everyone else renders the
// box it was given.
//
// Like the rest of `src/shared`, this file may not touch the DOM.
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import {
  LOCAL_ORIGIN,
  deleteObjects,
  registerObjectTypeModel,
  registerObjectTypeReader,
  type BoardObject,
  type ObjectSnapshot,
} from '../board-model';
import type { Point } from '../geometry';

/** A text object as the board reads it. */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  /** Who made it. Story 6 (identity) is not built, so this is the local device id. */
  createdBy?: string;
  createdAt?: number;
}

/** The line box height of a size, in board units — one line of that size. */
export const textLineHeight = (size: TextSize): number =>
  TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

/**
 * True for the kind that carries text, a size and a width mode. Story 2 has the
 * same helper for notes; a snapshot of a text object is read by
 * `readTextSnapshot`, because the generic snapshot cannot carry a `Y.Text`.
 */
export const isTextSnapshot = (object: BoardObject): object is TextSnapshot =>
  object.type === 'text';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isSizeKey = (value: unknown): value is TextSize =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>('objects');

const isText = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && value.get('type') === 'text';

/**
 * Tell the shared model that a `text` object exists, and how narrow its side
 * handle may take it. Registering the client type (registry.tsx) does this too;
 * doing it here as well is what makes the model able to read a text object in a
 * unit test, or in the Worker, with no DOM and no React in sight.
 */
registerObjectTypeModel('text', TEXT_MIN_WIDTH_WORLD);
// And how it is read: without this the generic snapshot would carry a text object's
// position and none of its words, and the board would draw an empty box.
registerObjectTypeReader('text', readTextObject);

/**
 * The box a text object is created with, before anything has been measured: one
 * empty line of its size, as narrow as a text object is ever allowed to be. It is
 * an estimate on purpose — a box has to exist for the selection, the marquee and
 * the overlay to have something to draw before the first measurement arrives.
 */
export const initialTextBox = (size: TextSize): { width: number; height: number } => ({
  width: Math.min(
    TEXT_MAX_AUTO_WIDTH_WORLD,
    Math.max(TEXT_MIN_WIDTH_WORLD, TEXT_SIZES[size] * TEXT_LINE_HEIGHT),
  ),
  height: textLineHeight(size),
});

/**
 * Place plain text with its **top-left at `at`** (not centred, unlike a sticky
 * note): size M, auto width, no characters yet, above every other object, in one
 * local transaction. Returns the new id, or null for a point that is not a place
 * on the board — and then nothing at all is written.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
  size: TextSize = DEFAULT_TEXT_SIZE,
): string | null {
  if (
    at === null ||
    typeof at !== 'object' ||
    !isFiniteNumber(at.x) ||
    !isFiniteNumber(at.y)
  ) {
    return null;
  }
  const sizeKey: TextSize = isSizeKey(size) ? size : DEFAULT_TEXT_SIZE;

  let maxZ = 0;
  objectsMap(doc).forEach((value) => {
    const z = value instanceof Y.Map ? value.get('z') : undefined;
    if (isFiniteNumber(z) && z > maxZ) maxZ = z;
  });

  const id = crypto.randomUUID();
  const box = initialTextBox(sizeKey);
  const object = new Y.Map<unknown>();
  doc.transact(() => {
    object.set('type', 'text');
    object.set('x', at.x);
    object.set('y', at.y);
    object.set('width', box.width);
    object.set('height', box.height);
    object.set('z', maxZ + 1);
    object.set('createdAt', Date.now());
    object.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    object.set('text', new Y.Text());
    object.set('size', sizeKey);
    object.set('widthMode', 'auto');
    objectsMap(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Pick one of the four sizes. The *position stays where it is* (the top-left
 * corner does not move); the width and height are somebody else's business —
 * `useTextBoxSync` recomputes them after this returns true.
 *
 * An unknown size name is refused without a transaction: writing a size nothing
 * has a font size for would leave an object rendered at no size at all.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isSizeKey(size)) return false;
  const object = objectsMap(doc).get(id);
  if (!isText(object)) return false;
  if (object.get('size') === size) return false;
  doc.transact(() => {
    object.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * A side handle was dragged: the object keeps a **fixed width** from now on and
 * its text rewraps to it. Never narrower than TEXT_MIN_WIDTH_WORLD (nor wider than
 * the one size every object shares), and never in a state where the width is set
 * but the mode is not — both are written in one transaction.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const object = objectsMap(doc).get(id);
  if (!isText(object)) return false;
  const clamped = Math.min(Math.max(width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  if (object.get('width') === clamped && object.get('widthMode') === 'fixed') return false;
  doc.transact(() => {
    object.set('width', clamped);
    object.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Write the measured box. The layout is the caller's (only the client that made a
 * local change measures — see Key decision 1); this is the one place the numbers
 * land in the document, and they land together so an undo reverts the text's box
 * in the same step as the text.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const object = objectsMap(doc).get(id);
  if (!isText(object)) return false;
  const size = isSizeKey(object.get('size')) ? (object.get('size') as TextSize) : DEFAULT_TEXT_SIZE;
  // One line of the object's own size is the shortest box it can be given: the
  // height always follows the content, and the content is never shorter than a line.
  const minHeight = textLineHeight(size);
  const width = Math.min(Math.max(box.width, TEXT_MIN_WIDTH_WORLD), MAX_OBJECT_SIZE_WORLD);
  const height = Math.min(Math.max(box.height, minHeight), MAX_OBJECT_SIZE_WORLD);
  if (object.get('width') === width && object.get('height') === height) return false;
  doc.transact(() => {
    object.set('width', width);
    object.set('height', height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The object's shared text, or undefined for a missing / non-text id. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objectsMap(doc).get(id);
  if (!isText(object)) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Zero characters — and only zero characters. A text object holding a space is
 * somebody's deliberate content, is visible on the board, and is not thrown away
 * because it happens to look like nothing (TC-04).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  return text !== undefined && text.length === 0;
}

/**
 * Ending an edit that produced no characters removes the object entirely — never
 * an invisible, unreachable nothing sitting on the board. Story 7's generic
 * `deleteObjects`, so a delete is a delete like any other (and undoable like one).
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isText(objectsMap(doc).get(id))) return false;
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) > 0;
}

/**
 * Read one text object out of the document — the fields the generic
 * `snapshotObjects` does not carry (text, size, widthMode), for the component that
 * draws it. Null when the id is gone or is some other kind of object: the
 * component then draws nothing, which is what "somebody else deleted it while I was
 * in it" looks like.
 */
export function readTextSnapshot(doc: Y.Doc, id: string): TextSnapshot | null {
  return readTextObject(id, objectsMap(doc).get(id));
}

/**
 * The same read, from the `Y.Map` the board already has in hand. This is the
 * function `snapshotObjects` uses for a text object — registered below, so
 * `board-model` never has to import this module to draw one (the same direction of
 * dependency as `registerObjectTypeModel`, and for the same reason: no cycle).
 */
export function readTextObject(
  id: string,
  object: Y.Map<unknown> | undefined,
): TextSnapshot | null {
  if (!isText(object)) return null;
  const text = object.get('text');
  const size = object.get('size');
  const widthMode = object.get('widthMode');
  const createdBy = object.get('createdBy');
  const createdAt = object.get('createdAt');
  const width = object.get('width');
  const height = object.get('height');
  return {
    id,
    type: 'text',
    x: isFiniteNumber(object.get('x')) ? (object.get('x') as number) : 0,
    y: isFiniteNumber(object.get('y')) ? (object.get('y') as number) : 0,
    z: isFiniteNumber(object.get('z')) ? (object.get('z') as number) : 0,
    width: isFiniteNumber(width) ? width : undefined,
    height: isFiniteNumber(height) ? height : undefined,
    text: text instanceof Y.Text ? text.toString() : '',
    size: isSizeKey(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
    createdBy: typeof createdBy === 'string' ? createdBy : undefined,
    createdAt: isFiniteNumber(createdAt) ? createdAt : undefined,
  };
}

/** Every text object in the document, in draw order. */
export function textSnapshots(doc: Y.Doc): TextSnapshot[] {
  const out: TextSnapshot[] = [];
  objectsMap(doc).forEach((value, key) => {
    if (!isText(value)) return;
    const snapshot = readTextSnapshot(doc, key);
    if (snapshot) out.push(snapshot);
  });
  return out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : 1));
}
