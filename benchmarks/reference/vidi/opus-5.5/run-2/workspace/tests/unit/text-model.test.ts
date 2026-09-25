/** Story 9 text.model unit tests (TC-01 to TC-06) on a real Y.Doc. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, LOCAL_ORIGIN, snapshotObjects } from '../../src/shared/board-model';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isTextSnapshot,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';

function countUpdates(doc: Y.Doc): { readonly count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function field(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)?.get(key);
}

function textSnap(doc: Y.Doc, id: string): TextSnapshot {
  const obj = snapshotObjects(doc).find((o) => o.id === id);
  if (obj === undefined || !isTextSnapshot(obj)) throw new Error('not a text object');
  return obj;
}

describe('text.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-01 createText: type text, size M, auto width, empty Y.Text, z on top, createdBy', () => {
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const updates = countUpdates(doc);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(updates.count).toBe(1);
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
    const t = textSnap(doc, id!);
    expect(t).toMatchObject({ type: 'text', x: 100, y: 50, size: DEFAULT_TEXT_SIZE, widthMode: 'auto', text: '' });
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(getTextContent(doc, id!)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id!)!.length).toBe(0);
    const others = snapshotObjects(doc).filter((o) => o.id !== id);
    expect(t.z).toBeGreaterThan(Math.max(...others.map((o) => o.z)));
    expect(field(doc, id!, 'createdBy')).toBe('g_test');
    expect(t.width).toBeGreaterThan(0);
    expect(t.height).toBeGreaterThan(0);
  });

  it('TC-02 setTextSize: XL applied; unknown key XXL rejected without an update', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = countUpdates(doc);
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textSnap(doc, id).size).toBe('XL');
    expect(updates.count).toBe(1);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 'XL')).toBe(false); // unchanged
    expect(updates.count).toBe(1);
    expect(textSnap(doc, id).size).toBe('XL');
  });

  it('TC-03 setTextWidthFixed below the minimum clamps to TEXT_MIN_WIDTH_WORLD and turns fixed', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const t = textSnap(doc, id);
    expect(t.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(t.widthMode).toBe('fixed');
    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(textSnap(doc, id).width).toBe(120);
    const updates = countUpdates(doc);
    expect(setTextWidthFixed(doc, id, 120)).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('TC-04 zero characters is empty and removed; whitespace-only text is kept', () => {
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const spaces = createText(doc, { x: 0, y: 100 }, 'g_test')!;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    const ids = snapshotObjects(doc).map((o) => o.id);
    expect(ids).toEqual([spaces]);
    expect(isEmptyText(doc, empty)).toBe(false); // gone
  });

  it('TC-05 clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    const almost = 'a'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${almost}b`, TEXT_MAX_CHARS)).toBe(`${almost}b`);
  });

  it('TC-06 non-finite create point → null, no transaction', () => {
    const updates = countUpdates(doc);
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(updates.count).toBe(0);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('stale ids and invalid boxes are rejected by every setter without an update', () => {
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = countUpdates(doc);
    for (const target of ['missing', sticky]) {
      expect(setTextSize(doc, target, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, target, 100)).toBe(false);
      expect(setTextBox(doc, target, { width: 10, height: 10 })).toBe(false);
      expect(deleteIfEmpty(doc, target)).toBe(false);
      expect(getTextContent(doc, target)).toBeUndefined();
    }
    expect(setTextBox(doc, id, { width: 0, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 10 })).toBe(false);
    expect(updates.count).toBe(0);
    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(true);
    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(false);
    expect(updates.count).toBe(1);
  });
});
