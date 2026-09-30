// `text.model` — the text object's document contract, tested against a real Y.Doc
// (design: Mock vs real boundaries — "Y.Doc, UndoManager: Real").
//
// TC-01 to TC-06 plus the stale-id rule that every setter shares. The document is
// real because the thing under test *is* the document: which fields a text object
// carries, which writes are refused without a transaction, and what counts as
// empty.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { LOCAL_ORIGIN, createSticky, initDoc } from '../../src/shared/board-model';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  readTextSnapshot,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  textLineHeight,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';

const CREATED_BY = 'g_test';

/** A board document with the schema in place, as the client leaves it. */
const seed = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

const raw = (doc: Y.Doc, id: string): Y.Map<unknown> => {
  const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!(object instanceof Y.Map)) throw new Error(`"${id}" is not in the document`);
  return object;
};

/** Count the transactions that touched the document while `body` ran. */
const updatesDuring = (doc: Y.Doc, body: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  body();
  doc.off('update', observer);
  return updates;
};

describe('text object model (text.model)', () => {
  // TC-01: create at a point, top-left there, size M, auto width, empty Y.Text, on
  // top of everything, made by this client.
  it('TC-01 creates a size M auto-width text object with its top-left at the point', () => {
    const doc = seed();
    const note = createSticky(doc, { x: 10, y: 10 });
    const noteZ = raw(doc, note).get('z') as number;

    const id = createText(doc, { x: 100, y: 50 }, CREATED_BY);
    expect(id).not.toBeNull();
    const object = raw(doc, id as string);

    expect(object.get('type')).toBe('text');
    expect(object.get('x')).toBe(100);
    expect(object.get('y')).toBe(50);
    expect(object.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(object.get('size')).toBe('M');
    expect(object.get('widthMode')).toBe('auto');
    const text = object.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).length).toBe(0);
    expect((object.get('z') as number) > noteZ).toBe(true);
    expect(object.get('createdBy')).toBe(CREATED_BY);
    // A box exists before anything has been measured, so bounds are never missing.
    expect(object.get('width')).toBeGreaterThan(0);
    expect(object.get('height')).toBe(textLineHeight(DEFAULT_TEXT_SIZE));
    expect(TEXT_SIZES[DEFAULT_TEXT_SIZE]).toBe(20);
  });

  it('TC-01b a created text object is readable as a snapshot of its own kind', () => {
    const doc = seed();
    const id = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;
    const snapshot = readTextSnapshot(doc, id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.type).toBe('text');
    expect(snapshot?.size).toBe('M');
    expect(snapshot?.widthMode).toBe('auto');
    expect(snapshot?.text).toBe('');
  });

  // TC-02: a known size is applied; an unknown one is refused with no update event.
  it('TC-02 applies a known size and refuses an unknown one without a transaction', () => {
    const doc = seed();
    const id = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(raw(doc, id).get('size')).toBe('XL');

    const updates = updatesDuring(doc, () => {
      expect(setTextSize(doc, id, 'XXL')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(raw(doc, id).get('size')).toBe('XL');

    // Asking for the size it already has changes nothing either.
    expect(updatesDuring(doc, () => expect(setTextSize(doc, id, 'XL')).toBe(false))).toBe(0);
  });

  // TC-03: a handle drag below the minimum lands *at* the minimum, and the object
  // is fixed-width from then on.
  it('TC-03 clamps a fixed width to TEXT_MIN_WIDTH_WORLD and switches the mode', () => {
    const doc = seed();
    const id = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const object = raw(doc, id);
    expect(object.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(object.get('widthMode')).toBe('fixed');

    // Exactly the minimum is accepted, and a wide one is taken as asked.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false);
    expect(setTextWidthFixed(doc, id, 320)).toBe(true);
    expect(raw(doc, id).get('width')).toBe(320);
    expect(raw(doc, id).get('widthMode')).toBe('fixed');
  });

  // TC-04: zero characters is empty; whitespace is content.
  it('TC-04 treats zero characters as empty and whitespace-only text as content', () => {
    const doc = seed();
    const id = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(id)).toBe(false);

    const kept = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;
    getTextContent(doc, kept)?.insert(0, '  ');
    expect(isEmptyText(doc, kept)).toBe(false);
    expect(deleteIfEmpty(doc, kept)).toBe(false);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(kept)).toBe(true);
  });

  // TC-05: the length limit, at its boundaries.
  it('TC-05 clamps text to TEXT_MAX_CHARS characters', () => {
    expect(clampToLimit('a'.repeat(5001), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('a'.repeat(5000), TEXT_MAX_CHARS)).toHaveLength(5000);
    // 4,999 plus one more is accepted: the limit is inclusive.
    expect(clampToLimit('a'.repeat(4999) + 'b', TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(TEXT_MAX_CHARS).toBe(5000);
  });

  it('TC-05b writes the clamped text through the shared minimal diff', () => {
    const doc = seed();
    const id = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;
    const ytext = getTextContent(doc, id);
    if (!ytext) throw new Error('no text for the new object');

    const clamped = clampToLimit('x'.repeat(TEXT_MAX_CHARS + 7), TEXT_MAX_CHARS);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(TEXT_MAX_CHARS);

    // Typing one more character at the limit adds nothing: the editor clamps the
    // string it is about to write, and the write is then a no-op.
    applyTextDiff(ytext, clampToLimit(`${clamped}y`, TEXT_MAX_CHARS), LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(TEXT_MAX_CHARS);
    expect(ytext.toString().endsWith('y')).toBe(false);
  });

  // TC-06: a point that is not a place on the board creates nothing at all.
  it('TC-06 refuses a non-finite create point with null and no transaction', () => {
    const doc = seed();
    for (const point of [
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
    ]) {
      const updates = updatesDuring(doc, () => {
        expect(createText(doc, point, CREATED_BY)).toBeNull();
      });
      expect(updates).toBe(0);
    }
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
  });

  it('refuses every setter on a stale id, without an update event', () => {
    const doc = seed();
    const stale = 'never-was';
    const updates = updatesDuring(doc, () => {
      expect(setTextSize(doc, stale, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, stale, 200)).toBe(false);
      expect(setTextBox(doc, stale, { width: 200, height: 40 })).toBe(false);
      expect(deleteIfEmpty(doc, stale)).toBe(false);
      expect(isEmptyText(doc, stale)).toBe(false);
      expect(getTextContent(doc, stale)).toBeUndefined();
      expect(readTextSnapshot(doc, stale)).toBeNull();
    });
    expect(updates).toBe(0);
  });

  it('refuses a setter aimed at another kind of object', () => {
    const doc = seed();
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(setTextSize(doc, note, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, note, 100)).toBe(false);
    expect(setTextBox(doc, note, { width: 100, height: 20 })).toBe(false);
    expect(deleteIfEmpty(doc, note)).toBe(false);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(note)).toBe(true);
  });

  it('writes a measured box only when it differs, and never a useless one', () => {
    const doc = seed();
    const id = createText(doc, { x: 0, y: 0 }, CREATED_BY) as string;
    const before = readTextSnapshot(doc, id);

    expect(setTextBox(doc, id, { width: before?.width ?? 0, height: before?.height ?? 0 })).toBe(false);
    expect(setTextBox(doc, id, { width: 240, height: 52 })).toBe(true);
    const after = readTextSnapshot(doc, id);
    expect(after?.width).toBe(240);
    expect(after?.height).toBe(52);

    // Numbers that are not sizes are refused outright, not clamped into place.
    const updates = updatesDuring(doc, () => {
      expect(setTextBox(doc, id, { width: Number.NaN, height: 40 })).toBe(false);
      expect(setTextBox(doc, id, { width: 100, height: 0 })).toBe(false);
      expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
    });
    expect(updates).toBe(0);
    expect(readTextSnapshot(doc, id)?.width).toBe(240);
    // Height never goes below one line of the object's own size: it is lifted to it.
    expect(setTextBox(doc, id, { width: 240, height: 1 })).toBe(true);
    expect(readTextSnapshot(doc, id)?.height).toBe(textLineHeight('M'));
    expect(readTextSnapshot(doc, id)?.width).toBe(240);
  });

  it('every text size is a board-unit font size and a whole number of line boxes', () => {
    expect(TEXT_SIZES).toEqual({ S: 14, M: 20, L: 32, XL: 56 });
    expect(TEXT_LINE_HEIGHT).toBeCloseTo(1.3, 10);
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      expect(textLineHeight(size)).toBeCloseTo(TEXT_SIZES[size] * TEXT_LINE_HEIGHT, 10);
    }
  });

  it('removes an emptied text object as its own undoable step', () => {
    const doc = seed();
    const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
      captureTimeout: -1,
    });
    const id = createText(doc, { x: 5, y: 5 }, CREATED_BY) as string;
    const ytext = getTextContent(doc, id);
    if (!ytext) throw new Error('no text for the new object');
    applyTextDiff(ytext, 'hi', LOCAL_ORIGIN);
    expect(deleteIfEmpty(doc, id)).toBe(false);

    // Typing the last character away, then ending the edit, is what removes it.
    applyTextDiff(ytext, '', LOCAL_ORIGIN);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(id)).toBe(false);

    // One undo brings the object back (empty), the next its characters.
    manager.undo();
    expect(doc.getMap<Y.Map<unknown>>('objects').has(id)).toBe(true);
    expect(getTextContent(doc, id)?.toString()).toBe('');
    manager.undo();
    expect(getTextContent(doc, id)?.toString()).toBe('hi');
  });
});
