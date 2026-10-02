// text.model unit tests (TC-01 … TC-06) against a REAL Y.Doc: the schema rules
// under test are Yjs's own — a transaction that writes nothing must emit nothing,
// a stale id must be refused — so a mocked document would hide the behaviour.
import { describe, expect, it } from 'vitest';
import { Doc, Map as YMap, Text as YText } from 'yjs';
import {
  createSticky,
  deleteObjects,
  getObjects,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  snapshotAll,
} from '../../src/shared/board-model';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';

/** Counts the `update` events a doc emits: 1 per successful mutation, 0 per rejection. */
function updateCounter(doc: Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count++;
  });
  return () => count;
}

function newDoc(): Doc {
  const doc = new Doc();
  initDoc(doc);
  return doc;
}

/** Read the raw per-object Y.Map for schema-level assertions. */
function rawObject(doc: Doc, id: string): YMap<unknown> {
  return getObjects(doc).get(id)!;
}

function textOf(doc: Doc, id: string): TextSnapshot {
  const object = snapshotAll(doc).find((obj) => obj.id === id);
  if (object === undefined || object.type !== 'text') throw new Error(`no text object ${id}`);
  return object;
}

describe('createText', () => {
  // TC-01: create at a point → a text object, size M, auto width, no characters, on top.
  it('TC-01 creates a size M auto-width text object with an empty Y.Text on top', () => {
    const doc = newDoc();
    const updates = updateCounter(doc);
    const sticky = createStickyAt(doc, 10, 10);

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(updates()).toBe(2); // the sticky, then the text: one transaction each

    const object = textOf(doc, id!);
    expect(object.type).toBe('text');
    // Unlike a sticky note, the point given is the top-left of the box.
    expect(object.x).toBe(100);
    expect(object.y).toBe(50);
    expect(object.size).toBe('M');
    expect(object.size).toBe(DEFAULT_TEXT_SIZE);
    expect(object.widthMode).toBe('auto');
    expect(object.text).toBe('');
    // It is drawn above everything that was already on the board.
    expect(object.z).toBeGreaterThan(getObjects(doc).get(sticky)!.get('z') as number);
    // A box exists from the start, so the object has bounds before anyone measures.
    expect(object.width).toBeGreaterThan(0);
    expect(object.height).toBeCloseTo(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);

    const map = rawObject(doc, id!);
    expect(map.get('createdBy')).toBe('g_test');
    expect(map.get('text')).toBeInstanceOf(YText);
    expect((map.get('createdAt') as number) / 1000 / 3600 / 24 / 365).toBeGreaterThan(20);
  });

  // TC-06: a point that is not a pair of numbers creates nothing at all.
  it('TC-06 refuses a non-finite point with null, no update event and no object', () => {
    const doc = newDoc();
    const updates = updateCounter(doc);

    for (const at of [
      { x: Number.NaN, y: 50 },
      { x: 100, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 50 },
      { x: 100, y: Number.POSITIVE_INFINITY },
    ]) {
      expect(createText(doc, at, 'g_test')).toBeNull();
    }
    expect(updates()).toBe(0);
    expect(snapshotAll(doc)).toHaveLength(0);
  });

  it('stacks each new text object above the one before it', () => {
    const doc = newDoc();
    const first = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const second = createText(doc, { x: 10, y: 10 }, 'g_test')!;
    expect(textOf(doc, second).z).toBeGreaterThan(textOf(doc, first).z);
  });
});

describe('setTextSize', () => {
  // TC-02: a known size key is stored; x, y and the text are untouched.
  it('TC-02 stores XL and changes nothing else', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Went well');
    const before = textOf(doc, id);
    const updates = updateCounter(doc);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(updates()).toBe(1);

    const after = textOf(doc, id);
    expect(after.size).toBe('XL');
    expect(after.text).toBe('Went well');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.widthMode).toBe('auto');
  });

  // TC-02 (error path): an unknown size key is refused with no update at all.
  it('TC-02 rejects an unknown size key with false and no update event', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = updateCounter(doc);

    for (const size of ['XXL', 'M ', 'm', '', '56']) {
      expect(setTextSize(doc, id, size)).toBe(false);
    }
    expect(updates()).toBe(0);
    expect(textOf(doc, id).size).toBe('M');

    // Every key of TEXT_SIZES is accepted, and only those.
    for (const size of Object.keys(TEXT_SIZES) as TextSize[]) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(textOf(doc, id).size).toBe(size);
    }
  });

  it('refuses a stale id and a sticky note with false and no update event', () => {
    const doc = newDoc();
    const sticky = createStickyAt(doc, 0, 0);
    const updates = updateCounter(doc);

    expect(setTextSize(doc, 'missing-id', 'L')).toBe(false);
    expect(setTextSize(doc, sticky, 'L')).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('setTextWidthFixed', () => {
  // TC-03: a width becomes the object's fixed width.
  it('TC-03 stores the width and switches the object to fixed mode', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const updates = updateCounter(doc);

    expect(setTextWidthFixed(doc, id, 300)).toBe(true);
    expect(updates()).toBe(1);
    const object = textOf(doc, id);
    expect(object.widthMode).toBe('fixed');
    expect(object.width).toBe(300);
  });

  // TC-03: below the minimum it is clamped, not refused: a handle dragged past
  // the end of the text leaves a box that is as narrow as a box may be.
  it('TC-03 clamps a width under TEXT_MIN_WIDTH_WORLD to the minimum', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(textOf(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(textOf(doc, id).widthMode).toBe('fixed');

    expect(setTextWidthFixed(doc, id, -500)).toBe(true);
    expect(textOf(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD);

    // Exactly the minimum is the boundary: it is stored as it stands.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(textOf(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('refuses a non-finite width, a stale id and a sticky note with no update event', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const sticky = createStickyAt(doc, 0, 0);
    const updates = updateCounter(doc);

    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
    expect(setTextWidthFixed(doc, 'missing-id', 200)).toBe(false);
    expect(setTextWidthFixed(doc, sticky, 200)).toBe(false);
    expect(updates()).toBe(0);
    expect(textOf(doc, id).widthMode).toBe('auto');
  });
});

describe('setTextBox', () => {
  it('stores the measured box and leaves the width mode alone', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = updateCounter(doc);

    expect(setTextBox(doc, id, { width: 94, height: 26 })).toBe(true);
    expect(updates()).toBe(1);
    const object = textOf(doc, id);
    expect(object.width).toBe(94);
    expect(object.height).toBe(26);
    // Writing a measured box is not a person saying "fixed width".
    expect(object.widthMode).toBe('auto');
  });

  it('refuses a non-finite box, a stale id and a sticky note with no update event', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const sticky = createStickyAt(doc, 0, 0);
    const updates = updateCounter(doc);

    expect(setTextBox(doc, id, { width: Number.NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 94, height: Number.NaN })).toBe(false);
    expect(setTextBox(doc, 'missing-id', { width: 94, height: 26 })).toBe(false);
    expect(setTextBox(doc, sticky, { width: 94, height: 26 })).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe('isEmptyText and deleteIfEmpty', () => {
  // TC-04: an object with no characters is removed when editing ends.
  it('TC-04 removes a text object that holds no characters', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = updateCounter(doc);

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(updates()).toBe(1);
    expect(snapshotAll(doc)).toHaveLength(0);
  });

  // TC-04: whitespace is content. Only zero characters counts as empty.
  it('TC-04 keeps a whitespace-only object, because a space is somebody text', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, '  ');
    const updates = updateCounter(doc);

    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(updates()).toBe(0);
    expect(textOf(doc, id).text).toBe('  ');

    // A newline is content too; and a single character is content.
    getTextContent(doc, id)!.delete(0, 2);
    getTextContent(doc, id)!.insert(0, '\n');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
  });

  it('TC-04 removes the object only after every character is deleted', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'ab');
    expect(deleteIfEmpty(doc, id)).toBe(false);
    ytext.delete(0, 1);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    ytext.delete(0, 1);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(snapshotAll(doc)).toHaveLength(0);
  });

  it('answers false for a stale id and for a sticky note, and writes nothing', () => {
    const doc = newDoc();
    const sticky = createStickyAt(doc, 0, 0);
    const updates = updateCounter(doc);

    expect(isEmptyText(doc, 'missing-id')).toBe(false);
    expect(deleteIfEmpty(doc, 'missing-id')).toBe(false);
    // An empty sticky note is still a note: this never deletes across types.
    expect(isEmptyText(doc, sticky)).toBe(false);
    expect(deleteIfEmpty(doc, sticky)).toBe(false);
    expect(updates()).toBe(0);
    expect(snapshotAll(doc)).toHaveLength(1);
  });
});

describe('clampToLimit', () => {
  // TC-05: the boundary of TEXT_MAX_CHARS, both sides and at it.
  it('TC-05 keeps 4,999 plus one and drops the 5,001st character', () => {
    const atLimit = 'a'.repeat(TEXT_MAX_CHARS);
    const oneUnder = 'a'.repeat(TEXT_MAX_CHARS - 1);

    expect(clampToLimit(oneUnder, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(`${atLimit}x`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(`${atLimit}x`, TEXT_MAX_CHARS)).toBe(atLimit);
    expect(clampToLimit('abc', TEXT_MAX_CHARS)).toBe('abc');
    expect(clampToLimit('', TEXT_MAX_CHARS)).toBe('');
  });

  it('keeps a whole number of characters when a paste lands mid-surrogate-pair', () => {
    // Cutting at the limit never leaves half of a surrogate pair behind.
    const pasted = `${'x'.repeat(TEXT_MAX_CHARS - 1)}\u{1F389}`;
    const kept = clampToLimit(pasted, TEXT_MAX_CHARS);
    expect(kept).toBe('x'.repeat(TEXT_MAX_CHARS - 1));
    expect(kept).not.toContain('\ud83c');
  });
});

describe('a text object among the other objects', () => {
  it('is moved and deleted by the same generic operations as a sticky note', () => {
    const doc = newDoc();
    const sticky = createStickyAt(doc, 0, 0);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;

    expect(moveObjects(doc, new Map([[id, { x: 20, y: 30 }], [sticky, { x: 0, y: 5 }]]))).toBe(2);
    const moved = textOf(doc, id);
    expect(moved.x).toBe(20);
    expect(moved.y).toBe(30);
    expect(getObjects(doc).get(sticky)!.get('x')).toBe(0);

    // The generic delete takes it, and the snapshot no longer mentions it.
    expect(deleteObjects(doc, [id])).toBe(1);
    expect(snapshotAll(doc).map((obj) => obj.id)).toEqual([sticky]);
  });

  it('is in snapshotAll and not in the sticky-only snapshot', () => {
    const doc = newDoc();
    const sticky = createStickyAt(doc, 0, 0);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;

    expect(snapshotAll(doc).map((obj) => obj.id).sort()).toEqual([id, sticky].sort());
    expect(textOf(doc, id).type).toBe('text');
    expect(getTextContent(doc, id)).toBeInstanceOf(YText);
    expect(getTextContent(doc, sticky)).toBeUndefined();
  });

  it('skips an object of a kind this board does not know, and keeps the rest', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getObjects(doc).set('future-thing', new YMap());
    getObjects(doc).get('future-thing')!.set('type', 'image');

    expect(snapshotAll(doc).map((obj) => obj.id)).toEqual([id]);
  });

  it('falls back to the default size and a legal box when a document lost them', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 7, y: 9 }, 'g_test')!;
    const map = rawObject(doc, id);
    map.set('size', 'HUGE');
    map.set('width', -20);
    map.set('height', 'tall');
    map.set('widthMode', 'maybe');

    const object = textOf(doc, id);
    expect(object.size).toBe(DEFAULT_TEXT_SIZE);
    expect(object.widthMode).toBe('auto');
    expect(object.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(object.height).toBe(0);
  });
});

/** Create a sticky note and return its id, for "on top of what is there" checks. */
function createStickyAt(doc: Doc, x: number, y: number): string {
  return createSticky(doc, { x, y });
}

describe('LOCAL_ORIGIN', () => {
  it('is the origin every text mutation uses', () => {
    const doc = newDoc();
    const seen: unknown[] = [];
    doc.on('update', (_update: unknown, origin: unknown) => seen.push(origin));
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    setTextSize(doc, id, 'L');
    setTextBox(doc, id, { width: 100, height: 41.6 });
    expect(seen.length).toBeGreaterThan(1);
    for (const origin of seen) expect(origin).toBe(LOCAL_ORIGIN);
  });
});
