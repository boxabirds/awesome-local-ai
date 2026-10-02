import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
} from '../../src/shared/objects/text';
import { LOCAL_ORIGIN, getObjectsMap, createSticky } from '../../src/shared/board-model';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

describe('text model', () => {
  it('TC-01: createText(doc, {100,50}, "g_test") → type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    const doc = new Y.Doc();
    // Create an existing sticky to ensure z is above it
    createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(typeof id).toBe('string');

    const objects = getObjectsMap(doc);
    const m = objects.get(id!)!;
    expect(m.get('type')).toBe('text');
    expect(m.get('x')).toBe(100);
    expect(m.get('y')).toBe(50);
    expect(m.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(m.get('widthMode')).toBe('auto');
    expect(m.get('createdBy')).toBe('g_test');
    const text = m.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    // z should be above the existing sticky (which has z=1)
    expect(m.get('z')).toBeGreaterThan(1);
  });

  it('TC-02: setTextSize XL applied; "XXL" → false and no update', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    updateCount = 0;
    const result = setTextSize(doc, id, 'XL');
    expect(result).toBe(true);
    expect(updateCount).toBe(1);

    const objects = getObjectsMap(doc);
    const m = objects.get(id)!;
    expect(m.get('size')).toBe('XL');

    updateCount = 0;
    const result2 = setTextSize(doc, id, 'XXL');
    expect(result2).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('TC-03: setTextWidthFixed(id, 30) → width TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    const result = setTextWidthFixed(doc, id, 30);
    expect(result).toBe(true);

    const objects = getObjectsMap(doc);
    const m = objects.get(id)!;
    expect(m.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(m.get('widthMode')).toBe('fixed');
  });

  it('TC-03b: setTextWidthFixed(id, 100) → width 100 (above minimum)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    setTextWidthFixed(doc, id, 100);
    const objects = getObjectsMap(doc);
    const m = objects.get(id)!;
    expect(m.get('width')).toBe(100);
    expect(m.get('widthMode')).toBe('fixed');
  });

  it('TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept', () => {
    const doc = new Y.Doc();
    const id1 = createText(doc, { x: 0, y: 0 }, 'test')!;
    expect(isEmptyText(doc, id1)).toBe(true);
    expect(deleteIfEmpty(doc, id1)).toBe(true);
    expect(getObjectsMap(doc).has(id1)).toBe(false);

    const id2 = createText(doc, { x: 0, y: 0 }, 'test')!;
    const ytext = getTextContent(doc, id2)!;
    doc.transact(() => { ytext.insert(0, '  '); }, LOCAL_ORIGIN);
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(getObjectsMap(doc).has(id2)).toBe(true);
  });

  it('TC-05: clampToLimit with TEXT_MAX_CHARS: 5001 → 5000; 4999 + 1 accepted', () => {
    const s5001 = 'a'.repeat(5001);
    expect(clampToLimit(s5001, TEXT_MAX_CHARS).length).toBe(5000);

    const s4999 = 'a'.repeat(4999);
    expect(clampToLimit(s4999 + 'a', TEXT_MAX_CHARS).length).toBe(5000);

    const s5000 = 'a'.repeat(5000);
    expect(clampToLimit(s5000, TEXT_MAX_CHARS)).toBe(s5000);
  });

  it('TC-06: non-finite create point → null, no transaction', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(createText(doc, { x: NaN, y: 0 }, 'test')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'test')).toBeNull();
    expect(createText(doc, { x: -Infinity, y: 0 }, 'test')).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('stale id for every setter → false, no update', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(setTextSize(doc, 'nonexistent', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('setTextBox with non-finite values → false', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;

    expect(setTextBox(doc, id, { width: NaN, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: Infinity })).toBe(false);
  });

  it('setTextBox with same values → false (no redundant write)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const objects = getObjectsMap(doc);
    const m = objects.get(id)!;
    const w = m.get('width') as number;
    const h = m.get('height') as number;

    expect(setTextBox(doc, id, { width: w, height: h })).toBe(false);
  });
});
