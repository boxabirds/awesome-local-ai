/**
 * The text object: plain text placed anywhere on the board (`text.model`).
 *
 * The shape is deliberately small — `x`, `y`, `width`, `height`, `z`, `type`,
 * `createdBy` like every object, plus a `Y.Text` (so two people typing in the same
 * box merge instead of overwriting, `text.concurrent`), a `size` key, and a
 * `widthMode`.
 *
 * **`widthMode` is the whole of `text.auto_width`.** `auto` means the box is as
 * wide as its longest line up to `TEXT_MAX_AUTO_WIDTH_WORLD`; `fixed` means a
 * person dragged a side and the width is theirs until they change it again. The
 * *measurement* of a box is the client's job (`src/client/objects/textLayout.ts`,
 * which is the only place that measures), but the mode itself has to travel, so
 * it lives here in the document: a remote client that has never seen this text
 * needs to know whether to keep its width or re-flow it, and height must follow
 * content on every client rather than only on the one that typed.
 *
 * `width` and `height` are stored even though they are derived, exactly as a
 * sticky note stores its size: the selection, the marquee, the hit test and the
 * undo snapshots all work off `ObjectSnapshot`, and a client that cannot measure
 * still has to show the box in the right place.
 */
import * as Y from 'yjs';

import {
  DEFAULT_TEXT_SIZE,
  TEXT_BOX_SLACK_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
  type TextWidthMode,
} from '../config';
import { deleteObjects, highestZ, LOCAL_ORIGIN, OBJECTS_KEY, type ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';
import { isFiniteNumber } from '../util';
import { applyTextDiff } from '../text-edit';

/** The string this object writes to `type`. */
export const TEXT_TYPE = 'text';

/** An immutable view of one text object, as React renders it. */
export interface TextSnapshot extends ObjectSnapshot {
  readonly type: 'text';
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: TextWidthMode;
  readonly createdBy: string;
}

/** The four sizes, in board units. Shared by the layout, the toolbar and the editor. */
export { TEXT_SIZES };

/** Is this a size the board knows? Anything else came from a version we do not speak. */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

/**
 * The box of text with nothing in it, at the default size.
 *
 * A line of zero characters is `TEXT_BOX_SLACK_WORLD` wide — one caret's worth —
 * and one line tall. `createText` writes it so that a text object is never
 * missing a box, and so that the client that created it agrees with every other
 * client about an empty box without anyone having to measure it.
 */
export function emptyTextBox(): { width: number; height: number } {
  return {
    width: TEXT_BOX_SLACK_WORLD,
    height: TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT,
  };
}

/**
 * Place text at a point (`text.create`): size M, width following its (empty)
 * content, on top of everything else, owned by whoever asked for it.
 *
 * Returns the id, or null when the point is not a place — an infinite pointer
 * from a broken gesture must not put an unreadable object on the board for
 * everybody (`sticky.invalid`).
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return null;

  const box = emptyTextBox();
  const id = crypto.randomUUID();
  const z = highestZ(doc) + 1;
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('type', TEXT_TYPE);
    // The clicked point is the top-left, so the first character lands under the
    // pointer; a sticky note centres itself on the click and text must not.
    map.set('x', at.x);
    map.set('y', at.y);
    map.set('width', box.width);
    map.set('height', box.height);
    map.set('z', z);
    map.set('createdAt', Date.now());
    map.set('createdBy', createdBy);
    map.set('text', new Y.Text(''));
    map.set('size', DEFAULT_TEXT_SIZE);
    map.set('widthMode', 'auto');
    (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** The `Y.Text` of a text object, or undefined when there is no such text. */
export function getText(doc: Y.Doc, id: string): Y.Text | undefined {
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== TEXT_TYPE) return undefined;
  const value = map.get('text');
  return value instanceof Y.Text ? value : undefined;
}

/** Set the size (`text.size`). An unknown size is refused: the presets are the API. */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== TEXT_TYPE) return false;
  if (map.get('size') === size) return true;
  doc.transact(() => {
    map.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Drag the width to `width` and hold it there (`text.resize_width`).
 *
 * Setting a width by hand always leaves the box `fixed`, even when the width
 * asked for is exactly the one the box had picked for itself: what a person
 * dragged is what they meant. The width itself never goes below
 * `TEXT_MIN_WIDTH_WORLD`, and the height is left alone — the client recomputes it
 * from the new wrap, because a box that is too short would clip (`text.box`).
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!isFiniteNumber(width)) return false;
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== TEXT_TYPE) return false;
  const next = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  doc.transact(() => {
    if (map.get('widthMode') !== 'fixed') map.set('widthMode', 'fixed');
    if (map.get('width') !== next) map.set('width', next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Let the box choose its own width again (`text.resize_width`).
 *
 * The stored width stays where it is and simply stops being obeyed: the next
 * measurement replaces it, and a box that forgot its width in between would jump by a
 * distance nobody chose.
 */
export function setTextWidthAuto(doc: Y.Doc, id: string): boolean {
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== TEXT_TYPE) return false;
  if (map.get('widthMode') === 'auto') return true;
  doc.transact(() => {
    map.set('widthMode', 'auto');
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store the box a client measured (`text.box`): the width in fixed mode, and the
 * height that the wrapped content needs on every client.
 *
 * Writing the box that is already there changes nothing, which is what keeps the
 * per-keystroke remeasure from turning into sync traffic and undo steps.
 */
export function setTextBox(doc: Y.Doc, id: string, box: { width: number; height: number }): boolean {
  if (!isFiniteNumber(box.width) || !isFiniteNumber(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== TEXT_TYPE) return false;
  if (map.get('width') === box.width && map.get('height') === box.height) return true;
  doc.transact(() => {
    map.set('width', box.width);
    map.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Is this text empty (`text.delete_empty`)?
 *
 * Only zero characters count. Whitespace a person typed is theirs to keep, and a box of
 * text that quietly deletes itself while somebody is typing a space is worse than a
 * stray box on the board.
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getText(doc, id);
  return ytext !== undefined && ytext.toString().length === 0;
}

/**
 * Delete the text when it holds nothing, and report whether this is what happened.
 *
 * Leaving an empty text object behind would leave a frame on the board that no
 * longer does anything (`text.delete_empty`), so the editor calls this when it
 * lets go. An id that is already gone answers false rather than throwing: undo, a
 * remote delete and this all race for the same object.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  // Story 7's delete, so a text object leaves the board the same way everything
  // else does — one object, one transaction, one undo step.
  return deleteObjects(doc, [id]) === 1;
}

/**
 * Put `next` into a text object's `Y.Text` with the shared minimal diff, so that
 * typing here merges exactly the way a note's does (`text.limit`, `sticky.limit`).
 */
export function writeTextContent(doc: Y.Doc, id: string, next: string, origin: unknown): boolean {
  const ytext = getText(doc, id);
  if (!ytext) return false;
  applyTextDiff(ytext, next, origin);
  return true;
}

/**
 * Read a text object as `TextSnapshot`.
 *
 * `width` and `height` fall back to the box of empty text rather than to a sticky
 * note's, and a size or mode that is not one of ours falls back to the default:
 * an object from a newer version of the board should still render as text, at a
 * readable size, rather than as nothing at all.
 */
export function readTextSnapshot(doc: Y.Doc, id: string): TextSnapshot | null {
  const map = (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
  if (!map || map.get('type') !== TEXT_TYPE) return null;
  return snapshotFrom(id, map);
}

/**
 * Read one `objects` entry as a `TextSnapshot`.
 *
 * `board-model.ts` calls this from `readObject`, which is the single place every
 * reader of the board goes through; it is the text type's answer to `readSticky`.
 * It assumes the entry says `type: 'text'`.
 */
export function snapshotFrom(id: string, map: Y.Map<unknown>): TextSnapshot {
  const empty = emptyTextBox();
  const text = map.get('text');
  const size = map.get('size');
  const createdAt = map.get('createdAt');
  return {
    id,
    type: 'text',
    x: Number(map.get('x')),
    y: Number(map.get('y')),
    // A text object made before this build has no stored box: fall back to the
    // box of empty text, never to a sticky note's square.
    width: storedPositive(map.get('width'), empty.width),
    height: storedPositive(map.get('height'), empty.height),
    z: Number(map.get('z')),
    text: text instanceof Y.Text ? text.toString() : '',
    size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
    widthMode: map.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
    createdBy: String(map.get('createdBy') ?? ''),
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/** A stored size, or the fallback when it is missing, not a number or not positive. */
function storedPositive(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}
