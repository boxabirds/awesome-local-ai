import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, getObjectsMap, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
} from '../../src/shared/objects/text';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('text.model', () => {
  it('TC-01: createText(doc,{100,50},"g_test") → type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy', () => {
    const doc = freshDoc();
    // Create an existing sticky to verify z is above it
    createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(id).toBeTruthy();

    const objects = getObjectsMap(doc);
    const m = objects.get(id!);
    expect(m).toBeDefined();
    expect(m!.get('type')).toBe('text');
    expect(m!.get('x')).toBe(100);
    expect(m!.get('y')).toBe(50);
    expect(m!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(m!.get('widthMode')).toBe('auto');
    expect(m!.get('createdBy')).toBe('g_test');

    const text = m!.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');

    // z must be above the sticky (which was created first)
    const stickyId = [...objects.keys()].find((k) => k !== id)!;
    const stickyZ = objects.get(stickyId)!.get('z') as number;
    const textZ = m!.get('z') as number;
    expect(textZ).toBeGreaterThan(stickyZ);
  });

  it('TC-02: setTextSize XL applied; "XXL" → false and no update (error path)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 10, y: 10 }, 'user1')!;

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const m = getObjectsMap(doc).get(id)!;
    expect(m.get('size')).toBe('XL');

    const countBefore = updateCount;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    // No new update should have been emitted
    expect(updateCount).toBe(countBefore);
  });

  it('TC-03: setTextWidthFixed(id, 30) → width TEXT_MIN_WIDTH_WORLD, widthMode fixed (boundary)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'user1')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const m = getObjectsMap(doc).get(id)!;
    expect(m.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(m.get('widthMode')).toBe('fixed');
  });

  it('TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only is kept', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'user1')!;

    // Empty text
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(getObjectsMap(doc).has(id)).toBe(false);

    // Whitespace-only text is NOT empty (zero characters only)
    const id2 = createText(doc, { x: 10, y: 10 }, 'user1')!;
    const ytext = getTextContent(doc, id2)!;
    doc.transact(() => { ytext.insert(0, '  '); }, LOCAL_ORIGIN);
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(getObjectsMap(doc).has(id2)).toBe(true);
  });

  it('TC-05: clampToLimit with TEXT_MAX_CHARS: 5001 → 5000; 4999 + 1 accepted', () => {
    const s5001 = 'a'.repeat(5001);
    expect(clampToLimit(s5001, TEXT_MAX_CHARS)).toHaveLength(5000);

    const s4999 = 'a'.repeat(4999);
    const withOne = s4999 + 'b';
    expect(clampToLimit(withOne, TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit(withOne, TEXT_MAX_CHARS)).toBe(withOne);

    // Exactly at limit
    const s5000 = 'a'.repeat(5000);
    expect(clampToLimit(s5000, TEXT_MAX_CHARS)).toHaveLength(5000);
  });

  it('TC-06: non-finite create point → null, no transaction (error path)', () => {
    const doc = freshDoc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(createText(doc, { x: NaN, y: 0 }, 'user1')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'user1')).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('stale id for every setter → false, no update', () => {
    const doc = freshDoc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const staleId = 'nonexistent-id';
    expect(setTextSize(doc, staleId, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, staleId, 100)).toBe(false);
    expect(setTextBox(doc, staleId, { width: 100, height: 100 })).toBe(false);
    expect(getTextContent(doc, staleId)).toBeUndefined();
    expect(isEmptyText(doc, staleId)).toBe(true);
    expect(deleteIfEmpty(doc, staleId)).toBe(false); // no object to delete means can't delete
    expect(updateCount).toBe(0);
  });
});
