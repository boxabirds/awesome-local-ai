import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  objectSnapshots,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../../src/shared/config';
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
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';

/**
 * The text object model (anchor `text.model`), TC-01 to TC-06.
 *
 * Everything runs against a real Y.Doc: the schema rules, the "no transaction on
 * a rejected call" rule and the undo-relevant fact that a setter writes exactly
 * one change are all about real document behaviour, not about a fake store.
 */

const objectsOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('objects');

const raw = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined => {
  const value = objectsOf(doc).get(id);
  return value instanceof Y.Map ? value : undefined;
};

/** Count the updates a doc reports, so "no transaction" is measurable. */
function updateCounter(doc: Y.Doc): { count(): number; stop(): void } {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  return { count: () => updates, stop: () => doc.off('update', listener) };
}

const textSnapshots = (doc: Y.Doc): TextSnapshot[] =>
  objectSnapshots(doc).filter((obj): obj is TextSnapshot => obj.type === 'text');

const textSnapshotOf = (doc: Y.Doc, id: string): TextSnapshot => {
  const found = textSnapshots(doc).find((obj) => obj.id === id);
  if (!found) {
    throw new Error(`text object ${id} is not readable from the document`);
  }
  return found;
};

describe('text.model - creating text (TC-01, TC-06)', () => {
  it('TC-01 createText places a size M automatic text object on top of everything', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 300, y: 300 });
    const updates = updateCounter(doc);

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');

    expect(id).toBeTruthy();
    const entry = raw(doc, id!);
    expect(entry).toBeDefined();
    expect(entry!.get('type')).toBe('text');
    // The clicked point is the top-left corner, not the centre (`text.create`).
    expect(entry!.get('x')).toBe(100);
    expect(entry!.get('y')).toBe(50);
    expect(entry!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(entry!.get('size')).toBe('M');
    expect(entry!.get('widthMode')).toBe('auto');
    expect(entry!.get('createdBy')).toBe('g_test');
    const ytext = entry!.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');
    // Above the sticky note that was already on the board.
    const sticky = raw(doc, noteId)!;
    expect(Number(entry!.get('z'))).toBe(Number(sticky.get('z')) + 1);
    // A box exists from the first moment, so selection bounds are usable even
    // before anything is typed (`text.height`).
    expect(Number(entry!.get('width'))).toBeGreaterThan(0);
    expect(Number(entry!.get('height'))).toBeGreaterThan(0);
    expect(updates.count()).toBe(1);
    updates.stop();
  });

  it('TC-01 the model reads a text object back as a TextSnapshot', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, 'Went well');
    setTextSize(doc, id, 'XL');

    const snapshot = textSnapshotOf(doc, id);
    expect(snapshot.type).toBe('text');
    expect(snapshot.text).toBe('Went well');
    expect(snapshot.size).toBe('XL');
    expect(snapshot.widthMode).toBe('auto');
    expect(snapshot.createdBy).toBe('g_test');
  });

  it('TC-06 a point that is not a number creates nothing and opens no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = updateCounter(doc);

    expect(createText(doc, { x: Number.NaN, y: 5 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 1, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(createText(doc, { x: '100', y: 5 } as unknown as { x: number; y: number }, 'g_test')).toBeNull();

    expect(objectsOf(doc).size).toBe(0);
    expect(updates.count()).toBe(0);
    updates.stop();
  });
});

describe('text.model - size (TC-02)', () => {
  it('TC-02 setTextSize stores the preset key and keeps position and text', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, 'Went well');
    const before = textSnapshotOf(doc, id);
    const updates = updateCounter(doc);

    expect(setTextSize(doc, id, 'XL')).toBe(true);

    const after = textSnapshotOf(doc, id);
    expect(after.size).toBe< TextSize>('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.text).toBe('Went well');
    expect(after.widthMode).toBe('auto');
    expect(updates.count()).toBe(1);
    updates.stop();
  });

  it('TC-02 every declared size is accepted', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(textSnapshotOf(doc, id).size).toBe(size);
    }
    expect(TEXT_SIZES.S).toBe(14);
    expect(TEXT_SIZES.M).toBe(20);
    expect(TEXT_SIZES.L).toBe(32);
    expect(TEXT_SIZES.XL).toBe(56);
  });

  it('TC-02 an unknown size answers false and changes nothing (error path)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textSnapshotOf(doc, id);
    const updates = updateCounter(doc);

    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, '')).toBe(false);
    expect(setTextSize(doc, id, 20 as unknown as string)).toBe(false);

    const after = textSnapshotOf(doc, id);
    expect(after.size).toBe(before.size);
    expect(updates.count()).toBe(0);
    updates.stop();
  });

  it('a size that is already the size writes nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = updateCounter(doc);
    expect(setTextSize(doc, id, DEFAULT_TEXT_SIZE)).toBe(false);
    expect(updates.count()).toBe(0);
    updates.stop();
  });
});

describe('text.model - fixed width and box (TC-03)', () => {
  it('TC-03 a width below the minimum is clamped to it and the mode becomes fixed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 200, y: 60 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, 'Went well');

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);

    const entry = raw(doc, id)!;
    expect(Number(entry.get('width'))).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(entry.get('widthMode')).toBe('fixed');
    // Height is content's business, so a width change does not invent one.
    expect(Number(entry.get('height'))).toBeGreaterThan(0);
  });

  it('TC-03 a width at the minimum is accepted as it is', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(Number(raw(doc, id)!.get('width'))).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('setTextWidthFixed keeps the top-left corner where it was', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 320, y: 140 }, 'g_test')!;
    const before = textSnapshotOf(doc, id);
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    const after = textSnapshotOf(doc, id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('setTextBox stores the measured box, and an unchanged box writes nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const height = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

    expect(setTextBox(doc, id, { width: 120, height })).toBe(true);
    expect(Number(raw(doc, id)!.get('width'))).toBe(120);
    expect(Number(raw(doc, id)!.get('height'))).toBe(height);

    const updates = updateCounter(doc);
    expect(setTextBox(doc, id, { width: 120, height })).toBe(false);
    expect(updates.count()).toBe(0);
    updates.stop();
  });

  it('a non-finite box is refused without a transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textSnapshotOf(doc, id);
    const updates = updateCounter(doc);

    expect(setTextBox(doc, id, { width: Number.NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 120, height: Number.POSITIVE_INFINITY })).toBe(false);
    expect(setTextBox(doc, id, { width: 0, height: 26 })).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);

    const after = textSnapshotOf(doc, id);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(updates.count()).toBe(0);
    updates.stop();
  });
});

describe('text.model - empty text (TC-04)', () => {
  it('TC-04 zero characters is empty, and deleteIfEmpty removes the object', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(raw(doc, id)).toBeUndefined();
    expect(textSnapshots(doc)).toHaveLength(0);
  });

  it('TC-04 whitespace-only text is kept: only zero characters counts as empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, '   ');
    const updates = updateCounter(doc);

    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(raw(doc, id)).toBeDefined();
    expect(textSnapshotOf(doc, id).text).toBe('   ');
    expect(updates.count()).toBe(0);
    updates.stop();
  });

  it('deleteIfEmpty on a stale id answers false and changes nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const updates = updateCounter(doc);
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    expect(updates.count()).toBe(0);
    updates.stop();
  });
});

describe('text.model - the character limit (TC-05)', () => {
  it('TC-05 characters beyond TEXT_MAX_CHARS are not added', () => {
    const tooLong = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(tooLong, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);

    const atLimit = 'a'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-05 4,999 plus one is accepted (boundary)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;

    applyTextDiff(ytext, 'a'.repeat(TEXT_MAX_CHARS - 1), 'test-origin');
    expect(ytext.toString()).toHaveLength(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${ytext.toString()}b`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    applyTextDiff(ytext, clampToLimit(`${ytext.toString()}b`, TEXT_MAX_CHARS), 'test-origin');
    expect(ytext.toString()).toHaveLength(TEXT_MAX_CHARS);

    applyTextDiff(ytext, clampToLimit(`${ytext.toString()}c`, TEXT_MAX_CHARS), 'test-origin');
    expect(ytext.toString()).toHaveLength(TEXT_MAX_CHARS);
  });

  it('a clamp that would cut a surrogate pair drops the whole character', () => {
    const text = `${'a'.repeat(TEXT_MAX_CHARS - 1)}😀`;
    const kept = clampToLimit(text, TEXT_MAX_CHARS);
    expect(kept).toHaveLength(TEXT_MAX_CHARS - 1);
    expect(kept.endsWith('a')).toBe(true);
  });
});

describe('text.model - stale ids (every setter)', () => {
  it('every setter answers false or undefined for an id that is not on the board', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(setTextSize(doc, noteId, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, noteId, 100)).toBe(false);
    expect(setTextBox(doc, noteId, { width: 100, height: 26 })).toBe(false);
    expect(getTextContent(doc, noteId)).toBeUndefined();
    expect(setTextSize(doc, 'missing', 'L')).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 100, height: 26 })).toBe(false);
    expect(getTextContent(doc, 'missing')).toBeUndefined();

    expect(raw(doc, noteId)!.get('width')).toBeUndefined();
    expect(updates.count()).toBe(0);
    updates.stop();
  });

  it('a text object does not disturb objects of other types (TC-08 shape)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 0, y: 0 });
    const textId = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    const objects: readonly ObjectSnapshot[] = objectSnapshots(doc);
    expect(objects.map((obj) => obj.id).sort()).toEqual([noteId, textId].sort());
    expect(objects.find((obj) => obj.id === noteId)!.type).toBe('sticky');
    expect(objects.find((obj) => obj.id === textId)!.type).toBe('text');
    // The automatic maximum width is a setting, not a hard-coded number.
    expect(TEXT_MAX_AUTO_WIDTH_WORLD).toBe(600);
  });
});
