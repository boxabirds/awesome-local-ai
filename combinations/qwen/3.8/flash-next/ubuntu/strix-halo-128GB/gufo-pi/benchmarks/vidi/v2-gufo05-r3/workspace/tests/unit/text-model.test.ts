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
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

describe('text model', () => {
  // TC-01: createText at (100,50) → type 'text', size DEFAULT_TEXT_SIZE,
  // widthMode 'auto', empty Y.Text, z above existing objects, createdBy 'g_test'.
  it('TC-01 createText creates correct schema', () => {
    const doc = new Y.Doc();
    // Seed an existing object with z=5
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const existing = new Y.Map<unknown>();
    existing.set('type', 'sticky');
    existing.set('x', 0);
    existing.set('y', 0);
    existing.set('z', 5);
    existing.set('createdAt', 1000);
    objects.set('existing-id', existing);

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const obj = objects.get(id!)!;
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(obj.get('z')).toBe(6); // above existing z=5
    const text = obj.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
  });

  // TC-02: setTextSize XL applied; 'XXL' → false, no update event (error path).
  it('TC-02 setTextSize valid and invalid', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'user')!;

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = setTextSize(doc, id, 'XL');
    expect(result).toBe(true);
    const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(obj.get('size')).toBe('XL');

    updateCount = 0;
    const badResult = setTextSize(doc, id, 'XXL');
    expect(badResult).toBe(false);
    expect(updateCount).toBe(0); // no transaction
  });

  // TC-03: setTextWidthFixed(id, 30) → width TEXT_MIN_WIDTH_WORLD, widthMode 'fixed'.
  it('TC-03 setTextWidthFixed clamps to minimum', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'user')!;

    const result = setTextWidthFixed(doc, id, 30);
    expect(result).toBe(true);
    const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes;
  // whitespace-only text is kept (negative).
  it('TC-04 isEmptyText and deleteIfEmpty', () => {
    const doc = new Y.Doc();
    const id1 = createText(doc, { x: 0, y: 0 }, 'user')!;
    expect(isEmptyText(doc, id1)).toBe(true);
    expect(deleteIfEmpty(doc, id1)).toBe(true);
    // Object is gone
    expect(doc.getMap<Y.Map<unknown>>('objects').has(id1)).toBe(false);

    const id2 = createText(doc, { x: 0, y: 0 }, 'user')!;
    const ytext = getTextContent(doc, id2)!;
    ytext.insert(0, '   '); // whitespace only
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(id2)).toBe(true);
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5001 → 5000; 4999 + 1 accepted.
  it('TC-05 clampToLimit boundaries', () => {
    const long = 'a'.repeat(5001);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(5000);

    const almost = 'a'.repeat(4999);
    expect(clampToLimit(almost + 'b', TEXT_MAX_CHARS).length).toBe(5000);

    const exact = 'a'.repeat(5000);
    expect(clampToLimit(exact, TEXT_MAX_CHARS).length).toBe(5000);
  });

  // TC-06: non-finite create point → null, no transaction (error path).
  it('TC-06 createText rejects non-finite point', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(createText(doc, { x: NaN, y: 0 }, 'user')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'user')).toBeNull();
    expect(updateCount).toBe(0);
  });

  // Stale id for every setter → false, no update.
  it('stale id returns false for all setters', () => {
    const doc = new Y.Doc();
    expect(setTextSize(doc, 'gone', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 100, height: 50 })).toBe(false);
    expect(isEmptyText(doc, 'gone')).toBe(true);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
  });
});
