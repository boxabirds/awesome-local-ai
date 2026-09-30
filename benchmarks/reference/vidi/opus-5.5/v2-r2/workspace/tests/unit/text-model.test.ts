import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, createSticky, initDoc, objectsMap, objectsSnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('update', () => counter.count++);
  return counter;
}

function textMap(doc: Y.Doc, id: string) {
  return objectsMap(doc).get(id)!;
}

describe('text.model', () => {
  it('TC-01 createText → size M, auto width, empty Y.Text, on top, createdBy', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 50, y: 0 });
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toEqual(expect.any(String));
    expect(origins).toEqual([LOCAL_ORIGIN]);
    const m = textMap(doc, id!);
    expect(m.get('type')).toBe('text');
    expect(m.get('x')).toBe(100);
    expect(m.get('y')).toBe(50);
    expect(m.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(m.get('widthMode')).toBe('auto');
    expect(m.get('createdBy')).toBe('g_test');
    expect(m.get('z')).toBe(3);
    expect(getTextContent(doc, id!)?.toString()).toBe('');
    expect(m.get('width')).toBeGreaterThan(0);
    expect(m.get('height')).toBeGreaterThan(0);
    const snap = objectsSnapshot(doc).find((o) => o.id === id);
    expect(snap).toMatchObject({ type: 'text', x: 100, y: 50, text: '', size: 'M', widthMode: 'auto', z: 3 });
  });

  it('TC-02 setTextSize XL applies; unknown key XXL → false, no update', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textMap(doc, id).get('size')).toBe('XL');
    const updates = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 'XL')).toBe(false);
    expect(updates.count).toBe(0);
    expect(textMap(doc, id).get('size')).toBe('XL');
  });

  it('TC-03 setTextWidthFixed 30 → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(textMap(doc, id).get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(textMap(doc, id).get('widthMode')).toBe('fixed');
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(textMap(doc, id).get('width')).toBe(250);
  });

  it('TC-04 zero characters is empty and is removed; whitespace-only text is kept', () => {
    const doc = newDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectsMap(doc).has(empty)).toBe(false);

    const spaces = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(objectsMap(doc).has(spaces)).toBe(true);
  });

  it('TC-05 clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    expect(clampToLimit('a'.repeat(5001), TEXT_MAX_CHARS)).toHaveLength(5000);
    const atLimit = 'a'.repeat(4999) + 'b';
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
  });

  it('TC-06 non-finite create point → null, no transaction', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(updates.count).toBe(0);
    expect(objectsMap(doc).size).toBe(0);
  });

  it('stale ids, non-text objects and invalid numbers are rejected without an update', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 }) as string;
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = countUpdates(doc);
    for (const target of ['missing', sticky]) {
      expect(setTextSize(doc, target, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, target, 100)).toBe(false);
      expect(setTextBox(doc, target, { width: 10, height: 10 })).toBe(false);
      expect(getTextContent(doc, target)).toBeUndefined();
      expect(isEmptyText(doc, target)).toBe(false);
      expect(deleteIfEmpty(doc, target)).toBe(false);
    }
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: 0 })).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('setTextBox writes once and not again for the same box', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 94, height: 26 })).toBe(true);
    const updates = countUpdates(doc);
    expect(setTextBox(doc, id, { width: 94, height: 26 })).toBe(false);
    expect(updates.count).toBe(0);
    expect(objectsSnapshot(doc)[0]).toMatchObject({ width: 94, height: 26 });
  });
});
