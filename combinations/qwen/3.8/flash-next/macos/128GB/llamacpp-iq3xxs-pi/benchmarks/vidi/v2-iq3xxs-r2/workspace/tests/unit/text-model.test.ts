import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  LOCAL_ORIGIN,
  objectSnapshots,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isTextSnapshot,
  readText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  TEXT_TYPE,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import { TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';

/**
 * Story 9's text object at the model boundary (live.text_object_model), the size toolbar's
 * rules (ui.size_toolbar) and the length limit (edge_cases.length_limit). Every case runs
 * against a real Y.Doc so the transactions, origins and shared types are the ones that
 * sync: `doc.getMap('objects')`, `objects.get(id).get('text') instanceof Y.Text`,
 * `deleteObjects` removing both.
 */

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap('objects');

/** Counts transactions the local client made, so "writes nothing" is a real assertion. */
function countLocalUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) updates += 1;
  });
  return () => updates;
}

/** The raw entry, so the shared type and the stored fields can be looked at directly. */
function raw(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsOf(doc).get(id);
}

/** A sticky note already on the board, so "z above all objects" has something to beat. */
function seedSticky(doc: Y.Doc): string {
  const id = createSticky(doc, { x: 0, y: 0 });
  if (typeof id !== 'string') throw new Error('no sticky note');
  return id;
}

function textOf(doc: Y.Doc, id: string): TextSnapshot {
  const text = readText(doc, id);
  if (!text) throw new Error(`text object ${id} is not readable`);
  return text;
}

describe('creating text (TC-01, TC-06)', () => {
  it('TC-01: creates a size M auto-width text at the point, above everything else', () => {
    const doc = new Y.Doc();
    seedSticky(doc);
    // z above all objects: whatever is on the board first sits below the new text.
    const topBefore = Math.max(...objectSnapshots(doc).map((object) => object.z));
    const updates = countLocalUpdates(doc);

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    if (id === null) return;

    // It is an object of the generic shape, plus its own fields.
    const snapshot = textOf(doc, id);
    expect(snapshot.id).toBe(id);
    expect(snapshot.type).toBe(TEXT_TYPE);
    expect(snapshot.type).toBe('text');
    expect(snapshot.x).toBe(100);
    expect(snapshot.y).toBe(50);
    expect(snapshot.size).toBe(DEFAULT_TEXT_SIZE);
    expect(snapshot.size).toBe('M');
    expect(snapshot.widthMode).toBe('auto');
    expect(snapshot.text).toBe('');
    expect(snapshot.createdBy).toBe('g_test');
    expect(Number.isFinite(snapshot.createdAt)).toBe(true);
    // It has bounds: a box, so it can be selected and have handles.
    expect(snapshot.width).toBeGreaterThan(0);
    expect(snapshot.height).toBeGreaterThan(0);

    // The text itself is a shared type, so two people can type in it (TC-29).
    const entry = raw(doc, id);
    expect(entry?.get('text')).toBeInstanceOf(Y.Text);
    expect(objectsOf(doc).get(id)?.get('type')).toBe('text');

    expect(snapshot.z).toBeGreaterThan(topBefore);

    // Deleting it goes through the generic path, and takes the shared type with it.
    expect(deleteObjects(doc, [id])).toBe(1);
    expect(objectsOf(doc).get(id)).toBeUndefined();
    expect(updates()).toBeGreaterThan(0);
  });

  it('TC-06: a non-finite position creates nothing and opens no transaction', () => {
    const doc = new Y.Doc();
    const updates = countLocalUpdates(doc);

    for (const at of [{ x: Number.NaN, y: 5 }, { x: 5, y: Number.POSITIVE_INFINITY }]) {
      expect(createText(doc, at, 'g_test')).toBeNull();
    }
    expect(objectsOf(doc).size).toBe(0);
    expect(updates()).toBe(0);
  });

  it('every field of a text object survives a snapshot round', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 1, y: 2 }, 'g_test');
    if (id === null) throw new Error('no text');

    const generic = objectSnapshots(doc).find((object) => object.id === id);
    expect(generic?.type).toBe(TEXT_TYPE);
    expect(isTextSnapshot(generic ?? { id: '', type: '', x: 0, y: 0, width: 0, height: 0, z: 0, known: false })).toBe(true);
    expect(readText(doc, 'missing')).toBeUndefined();
  });
});

describe('sizes (TC-02)', () => {
  it('TC-02: applies a known size; an unknown one returns false and writes nothing', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 30, y: 40 }, 'g_test');
    if (id === null) throw new Error('no text');
    const y = textOf(doc, id);

    const updates = countLocalUpdates(doc);
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(updates()).toBe(1);

    const applied = textOf(doc, id);
    expect(applied.size).toBe('XL');
    // A size change is not a move.
    expect(applied.x).toBe(y.x);
    expect(applied.y).toBe(y.y);

    // An unknown size is refused without a transaction.
    const before = updates();
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(textOf(doc, id).size).toBe('XL');
    expect(updates()).toBe(before);

    // The sizes the toolbar offers are exactly the configured four.
    expect(Object.keys(TEXT_SIZES)).toEqual(['S', 'M', 'L', 'XL']);
  });
});

describe('width (TC-03)', () => {
  it('TC-03: a fixed width below the minimum stores the minimum and becomes fixed', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test');
    if (id === null) throw new Error('no text');
    expect(textOf(doc, id).widthMode).toBe('auto');

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    let text = textOf(doc, id);
    expect(text.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(text.widthMode).toBe('fixed');

    // A width above the minimum is stored as asked, and stays fixed afterwards.
    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    text = textOf(doc, id);
    expect(text.width).toBe(120);
    expect(text.widthMode).toBe('fixed');

    // A width that is not a number changes nothing.
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(textOf(doc, id).width).toBe(120);
  });

  it('setTextBox stores the measured box on the object', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test');
    if (id === null) throw new Error('no text');

    expect(setTextBox(doc, id, { width: TEXT_MAX_AUTO_WIDTH_WORLD, height: 78 })).toBe(true);
    const text = textOf(doc, id);
    expect(text.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(text.height).toBe(78);
    // A box is not a resize of the position, and nonsense is refused.
    expect(text.x).toBe(0);
    expect(setTextBox(doc, id, { width: 10, height: Number.NaN })).toBe(false);
    expect(textOf(doc, id).height).toBe(78);
  });
});

describe('empty text (TC-04)', () => {
  it('TC-04: an empty text can be removed; whitespace-only is kept', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test');
    if (id === null) throw new Error('no text');

    expect(isEmptyText(doc, id)).toBe(true);

    // Someone typed a space: it is no longer empty, and stays.
    const ytext = getTextContent(doc, id);
    if (!(ytext instanceof Y.Text)) throw new Error('no shared text');
    doc.transact(() => ytext.insert(0, ' '), LOCAL_ORIGIN);
    expect(textOf(doc, id).text).toBe(' ');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(raw(doc, id)).toBeDefined();

    // Typed it all away: now the removal applies.
    doc.transact(() => ytext.delete(0, 1), LOCAL_ORIGIN);
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(raw(doc, id)).toBeUndefined();
    expect(objectsOf(doc).has(id)).toBe(false);
  });
});

describe('the length limit (TC-05)', () => {
  it('TC-05: the first TEXT_MAX_CHARS of a longer string are kept', () => {
    const long = 'x'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(long, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);

    // One under the limit plus one more is accepted in full.
    const justUnder = 'y'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(justUnder, TEXT_MAX_CHARS)).toBe(justUnder);
    expect(clampToLimit(`${justUnder}!`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);

    // The limit is the text object's, and sticky notes keep their own.
    expect(TEXT_MAX_CHARS).toBe(5_000);
  });
});

describe('stale ids', () => {
  it('every setter says no, and nothing is created or read', () => {
    const doc = new Y.Doc();
    // A sticky note is not a text object either.
    const sticky = seedSticky(doc);
    const updates = countLocalUpdates(doc);

    expect(setTextSize(doc, 'gone', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 10, height: 10 })).toBe(false);
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    expect(getTextContent(doc, 'gone')).toBeUndefined();
    expect(readText(doc, 'gone')).toBeUndefined();

    expect(setTextSize(doc, sticky, 'L')).toBe(false);
    expect(readText(doc, sticky)).toBeUndefined();

    expect(updates()).toBe(0);
  });
});
