/**
 * Story 9 unit tests for the text object model (`text.model`): TC-01 to TC-06, run
 * against a real `Y.Doc` because the schema rules — one transaction per change, a
 * rejection that costs no update at all, a `Y.Text` that two people can type into —
 * are the thing under test.
 *
 * Two rules hold for every setter here, and both are checked for every one of them:
 * a stale id or a non-finite number returns `false` *before* a transaction opens, so
 * a rejection produces no update event and no sync traffic, and a success is exactly
 * one `LOCAL_ORIGIN` transaction.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  boardObjects,
  createSticky,
  maxZ,
  objectMap,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  TEXT_OBJECT_TYPE,
  type TextSnapshot
} from '../../src/shared/objects/text';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

/** The one thing every rejection has in common: the document was never touched. */
function updatesDuring(doc: Y.Doc, run: () => void): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  run();
  doc.off('update', listener);
  return updates;
}

/** A board with one text object on it, and nothing else. */
function boardWithText(at = { x: 100, y: 50 }): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  const id = createText(doc, at, 'g_test');
  if (!id) throw new Error('the fixture could not create a text object');
  return { doc, id };
}

function field(doc: Y.Doc, id: string, key: string): unknown {
  return objectMap(doc, id)?.get(key);
}

/** The stored text of an object, written the way the editor writes it. */
function writeText(doc: Y.Doc, id: string, value: string): void {
  const text = getTextContent(doc, id);
  if (!text) throw new Error(`text object ${id} holds no Y.Text`);
  doc.transact(() => {
    if (text.length > 0) text.delete(0, text.length);
    if (value.length > 0) text.insert(0, value);
  });
}

function snapshotOf(doc: Y.Doc, id: string): TextSnapshot {
  const found = boardObjects(doc).find((object: ObjectSnapshot) => object.id === id);
  if (!found) throw new Error(`object ${id} is not in the snapshot`);
  return found as TextSnapshot;
}

describe('text model (text.model)', () => {
  it('TC-01: createText puts a size M auto-width text at the clicked point, on top', () => {
    const doc = new Y.Doc();
    const noteId = createSticky(doc, { x: 0, y: 0 });
    const noteTop = maxZ(doc);
    expect(noteTop).toBeGreaterThan(0);

    const madeAt = Date.now();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    // Top-left at the point that was clicked, not centred on it as a note is.
    expect(field(doc, id!, 'type')).toBe(TEXT_OBJECT_TYPE);
    expect(field(doc, id!, 'x')).toBe(100);
    expect(field(doc, id!, 'y')).toBe(50);
    expect(field(doc, id!, 'size')).toBe(DEFAULT_TEXT_SIZE);
    expect(field(doc, id!, 'widthMode')).toBe('auto');
    expect(field(doc, id!, 'createdBy')).toBe('g_test');
    // When it was made, like every other object on the board.
    expect(Number(field(doc, id!, 'createdAt'))).toBeGreaterThanOrEqual(madeAt);

    const text = field(doc, id!, 'text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');

    // Above every object that was already there.
    expect(field(doc, id!, 'z')).toBe(noteTop + 1);

    // A box exists before anything is measured, so the object has bounds to select.
    expect(Number(field(doc, id!, 'width'))).toBeGreaterThan(0);
    expect(Number(field(doc, id!, 'height'))).toBeGreaterThan(0);

    // And the shared snapshot reads it as a text object, note included.
    const read = snapshotOf(doc, id!);
    expect(read.type).toBe('text');
    expect(read.text).toBe('');
    expect(read.size).toBe(DEFAULT_TEXT_SIZE);
    expect(read.widthMode).toBe('auto');
    expect(read.createdAt).toBeGreaterThanOrEqual(madeAt);
    // A text that never said when it was made is not a reason to drop it: it reads as 0.
    objectMap(doc, id!)!.delete('createdAt');
    expect(snapshotOf(doc, id!).createdAt).toBe(0);
    expect(boardObjects(doc)).toHaveLength(2);
    expect(boardObjects(doc)[0]!.id).toBe(noteId);
  });

  it('TC-02: setTextSize takes a known preset and refuses an unknown one without a transaction', () => {
    const { doc, id } = boardWithText();

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(field(doc, id, 'size')).toBe('XL');

    // The error path: a size this build does not know leaves the object alone.
    expect(updatesDuring(doc, () => expect(setTextSize(doc, id, 'XXL')).toBe(false))).toBe(0);
    expect(field(doc, id, 'size')).toBe('XL');
    expect(updatesDuring(doc, () => expect(setTextSize(doc, id, '')).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextSize(doc, id, 42 as unknown as string)).toBe(false))).toBe(0);

    // Every preset is accepted, so the toolbar's four buttons are all real.
    for (const size of Object.keys(TEXT_SIZES)) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(field(doc, id, 'size')).toBe(size);
    }
  });

  it('TC-03: setTextWidthFixed clamps to the minimum width and switches to fixed mode', () => {
    const { doc, id } = boardWithText();
    expect(field(doc, id, 'widthMode')).toBe('auto');

    // The boundary: below the minimum, the box stops at the minimum.
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(field(doc, id, 'width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(field(doc, id, 'widthMode')).toBe('fixed');

    // Above it, the width asked for is the width given.
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(field(doc, id, 'width')).toBe(250);
    expect(field(doc, id, 'widthMode')).toBe('fixed');

    // Exactly the minimum stays the minimum.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(field(doc, id, 'width')).toBe(TEXT_MIN_WIDTH_WORLD);

    // A width that is not a number never reaches the document.
    expect(updatesDuring(doc, () => expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextWidthFixed(doc, id, 'wide' as unknown as number)).toBe(false))).toBe(
      0
    );
    expect(field(doc, id, 'width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-04: text with no characters is removed when editing ends, whitespace is kept', () => {
    const { doc, id } = boardWithText();

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objectMap(doc, id)).toBeUndefined();

    // Whitespace is characters: a heading of nothing but spaces was typed on purpose
    // (or is about to be), and deleting it here would throw away somebody's work.
    const kept = boardWithText();
    writeText(kept.doc, kept.id, '   ');
    expect(isEmptyText(kept.doc, kept.id)).toBe(false);
    expect(updatesDuring(kept.doc, () => expect(deleteIfEmpty(kept.doc, kept.id)).toBe(false))).toBe(0);
    expect(objectMap(kept.doc, kept.id)).toBeDefined();

    // Text that is not empty is never removed by this call.
    writeText(kept.doc, kept.id, 'Went well');
    expect(isEmptyText(kept.doc, kept.id)).toBe(false);
    expect(deleteIfEmpty(kept.doc, kept.id)).toBe(false);
    expect(snapshotOf(kept.doc, kept.id).text).toBe('Went well');
  });

  it('TC-05: the 5,000 character limit cuts what would cross it', () => {
    const tooLong = 'x'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(tooLong, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(tooLong, TEXT_MAX_CHARS)).toBe('x'.repeat(TEXT_MAX_CHARS));

    // The boundaries: exactly the limit, and one short of it plus one more.
    const atLimit = 'y'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
    const almost = 'z'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${almost}z`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(almost, TEXT_MAX_CHARS)).toBe(almost);
  });

  it('TC-06: a point that is not a number creates nothing and opens no transaction', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });

    for (const point of [
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: undefined as unknown as number, y: 0 },
      { x: 0, y: null as unknown as number }
    ]) {
      expect(updatesDuring(doc, () => expect(createText(doc, point, 'g_test')).toBeNull())).toBe(0);
    }
    expect(boardObjects(doc)).toHaveLength(1);
  });

  it('a stale id is refused by every setter, with no update', () => {
    const { doc } = boardWithText();
    const missing = 'no-such-object';

    expect(updatesDuring(doc, () => expect(setTextSize(doc, missing, 'L')).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextWidthFixed(doc, missing, 100)).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextBox(doc, missing, { width: 100, height: 20 })).toBe(false))).toBe(0);
    expect(getTextContent(doc, missing)).toBeUndefined();
    expect(isEmptyText(doc, missing)).toBe(false);
    expect(updatesDuring(doc, () => expect(deleteIfEmpty(doc, missing)).toBe(false))).toBe(0);
    for (const id of ['', null as unknown as string, 42 as unknown as string]) {
      expect(setTextSize(doc, id, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, id, 100)).toBe(false);
      expect(setTextBox(doc, id, { width: 100, height: 20 })).toBe(false);
      expect(getTextContent(doc, id)).toBeUndefined();
      expect(deleteIfEmpty(doc, id)).toBe(false);
    }
  });

  it('setTextBox stores a measured box and refuses one that is not a box', () => {
    const { doc, id } = boardWithText();

    expect(setTextBox(doc, id, { width: 137, height: 52 })).toBe(true);
    expect(field(doc, id, 'width')).toBe(137);
    expect(field(doc, id, 'height')).toBe(52);

    // The same box again writes nothing: a remeasure that agrees with the document is
    // not a change anybody else needs to hear about.
    expect(updatesDuring(doc, () => expect(setTextBox(doc, id, { width: 137, height: 52 })).toBe(false))).toBe(0);

    for (const box of [
      { width: Number.NaN, height: 20 },
      { width: 100, height: Number.POSITIVE_INFINITY },
      { width: 0, height: 20 },
      { width: -10, height: 20 },
      { width: 100, height: 0 },
      null as unknown as { width: number; height: number }
    ]) {
      expect(updatesDuring(doc, () => expect(setTextBox(doc, id, box)).toBe(false))).toBe(0);
    }
    expect(field(doc, id, 'width')).toBe(137);
    expect(field(doc, id, 'height')).toBe(52);
  });

  it('getTextContent hands out the shared Y.Text so typing merges', () => {
    const { doc, id } = boardWithText();
    const text = getTextContent(doc, id);
    expect(text).toBeInstanceOf(Y.Text);

    // Two writers, one after the other: every character is kept (text.concurrent).
    doc.transact(() => text!.insert(0, 'Went '), 'peer-a');
    doc.transact(() => text!.insert(text!.length, 'well'), 'peer-b');
    expect(text!.toString()).toBe('Went well');
    expect(snapshotOf(doc, id).text).toBe('Went well');
  });

  it('an object of another type is not read, moved or emptied as text', () => {
    const doc = new Y.Doc();
    const noteId = createSticky(doc, { x: 0, y: 0 });

    expect(getTextContent(doc, noteId)).toBeUndefined();
    expect(isEmptyText(doc, noteId)).toBe(false);
    expect(updatesDuring(doc, () => expect(deleteIfEmpty(doc, noteId)).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextSize(doc, noteId, 'L')).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextWidthFixed(doc, noteId, 100)).toBe(false))).toBe(0);
    expect(updatesDuring(doc, () => expect(setTextBox(doc, noteId, { width: 10, height: 10 })).toBe(false))).toBe(0);
    expect(boardObjects(doc)).toHaveLength(1);
  });
});
