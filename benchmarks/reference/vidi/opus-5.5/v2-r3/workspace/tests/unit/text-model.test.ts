import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  allObjectIds,
  createSticky,
  getObjectsMap,
  initDoc,
  objectsInRect,
  objectsSnapshot,
} from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
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
import { ANNOTATION_300, PASTE_5001 } from '../fixtures/texts';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number; origins: unknown[] } {
  const origins: unknown[] = [];
  const handler = (_u: Uint8Array, origin: unknown) => origins.push(origin);
  doc.on('update', handler);
  try {
    return { result: fn(), updates: origins.length, origins };
  } finally {
    doc.off('update', handler);
  }
}

function textSnap(doc: Y.Doc, id: string): TextSnapshot {
  const found = objectsSnapshot(doc).find((o) => o.id === id);
  if (!found) throw new Error('not found');
  return found as TextSnapshot;
}

describe('text.model', () => {
  it('fixtures have the lengths the design names', () => {
    expect(ANNOTATION_300).toHaveLength(300);
    expect(PASTE_5001).toHaveLength(5001);
  });

  it('TC-01 createText places an empty size-M auto-width text with its top-left at the point, on top', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    const { result: id, updates, origins } = countUpdates(doc, () => createText(doc, { x: 100, y: 50 }, 'g_test'));
    expect(id).toEqual(expect.any(String));
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const t = textSnap(doc, id!);
    expect(t).toMatchObject({
      type: 'text',
      x: 100,
      y: 50,
      size: DEFAULT_TEXT_SIZE,
      widthMode: 'auto',
      text: '',
      z: 3,
      createdBy: 'g_test',
    });
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(t.width).toBeGreaterThan(0);
    expect(t.height).toBeGreaterThan(0);
    expect(getTextContent(doc, id!)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id!)!.length).toBe(0);
    expect(getObjectsMap(doc).get(id!)!.get('createdBy')).toBe('g_test');
  });

  it('text objects take part in select all and box select (text.consistent)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const list = objectsSnapshot(doc);
    expect(allObjectIds(list)).toEqual([id]);
    expect(objectsInRect(list, { x: 90, y: 40, width: 100, height: 100 })).toEqual([id]);
  });

  it('TC-02 setTextSize applies a preset; an unknown key is rejected without an update', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textSnap(doc, id).size).toBe('XL');
    expect(textSnap(doc, id)).toMatchObject({ x: 0, y: 0 });
    const bad = countUpdates(doc, () => setTextSize(doc, id, 'XXL'));
    expect(bad).toMatchObject({ result: false, updates: 0 });
    expect(textSnap(doc, id).size).toBe('XL');
    // Same size again: no-op.
    expect(countUpdates(doc, () => setTextSize(doc, id, 'XL'))).toMatchObject({ result: false, updates: 0 });
  });

  it('TC-03 setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and switches to fixed width', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(textSnap(doc, id)).toMatchObject({ width: TEXT_MIN_WIDTH_WORLD, widthMode: 'fixed' });
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD + 60)).toBe(true);
    expect(textSnap(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD + 60);
  });

  it('TC-04 isEmptyText counts only zero characters; deleteIfEmpty removes empty text and keeps whitespace', () => {
    const doc = newDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const spaces = createText(doc, { x: 0, y: 100 }, 'g_test')!;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectsSnapshot(doc).map((o) => o.id)).toEqual([spaces]);
    expect(isEmptyText(doc, empty)).toBe(false); // gone
  });

  it('TC-05 clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    expect(clampToLimit(PASTE_5001, TEXT_MAX_CHARS)).toHaveLength(5000);
    const almost = PASTE_5001.slice(0, 4999);
    expect(clampToLimit(almost + 'x', TEXT_MAX_CHARS)).toBe(almost + 'x');
    expect(clampToLimit(almost + 'xy', TEXT_MAX_CHARS)).toBe(almost + 'x');
  });

  it('TC-06 a non-finite create point returns null without a transaction', () => {
    const doc = newDoc();
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
    ]) {
      expect(countUpdates(doc, () => createText(doc, at, 'g_test'))).toMatchObject({ result: null, updates: 0 });
    }
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  it('every setter rejects a stale id, a non-text object and non-finite numbers without an update', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    for (const target of ['missing', sticky]) {
      const r = countUpdates(doc, () => [
        setTextSize(doc, target, 'L'),
        setTextWidthFixed(doc, target, 100),
        setTextBox(doc, target, { width: 10, height: 10 }),
        deleteIfEmpty(doc, target),
      ]);
      expect(r).toMatchObject({ result: [false, false, false, false], updates: 0 });
    }
    const bad = countUpdates(doc, () => [
      setTextWidthFixed(doc, id, Number.NaN),
      setTextBox(doc, id, { width: Number.POSITIVE_INFINITY, height: 10 }),
      setTextBox(doc, id, { width: 0, height: 10 }),
    ]);
    expect(bad).toMatchObject({ result: [false, false, false], updates: 0 });
  });

  it('setTextBox writes once and is a no-op for the same box', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 94, height: 26 }))).toMatchObject({ result: true, updates: 1 });
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 94, height: 26 }))).toMatchObject({ result: false, updates: 0 });
    expect(textSnap(doc, id)).toMatchObject({ width: 94, height: 26 });
  });

  it('an unknown size or width mode stored by someone else reads as the defaults', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    doc.transact(() => {
      getObjectsMap(doc).get(id)!.set('size', 'HUGE');
      getObjectsMap(doc).get(id)!.set('widthMode', 'weird');
    });
    expect(textSnap(doc, id)).toMatchObject({ size: 'M', widthMode: 'auto' });
  });
});
