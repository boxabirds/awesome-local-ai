/**
 * Unit tests for the text object model (TC-01 to TC-06).
 * Uses a real Y.Doc; stubs are expected to fail initially.
 */
import { describe, it, expect, beforeEach } from 'vitest';
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
import { clampToLimit } from '../../src/shared/text-edit';
import {
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
import {
  createSticky,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';

describe('text model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: createText(doc, {100,50}, 'g_test') → type 'text', size M, widthMode 'auto', empty Y.Text, z above existing objects, createdBy 'g_test'.
  it('TC-01: createText creates a valid text object', () => {
    // Create a sticky first so we can verify z is above it
    const stickyId = createSticky(doc, { x: 50, y: 50 });
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const stickyObj = objects.get(stickyId)!;
    const stickyZ = stickyObj.get('z') as number;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(typeof id).toBe('string');

    const obj = objects.get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('text');
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
    expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj!.get('widthMode')).toBe('auto');
    expect(obj!.get('createdBy')).toBe('g_test');
    expect(obj!.get('z')).toBeGreaterThan(stickyZ);

    // Text content is an empty Y.Text
    const ytext = obj!.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');

    // Has width and height (initial estimate so bounds exist)
    expect(typeof obj!.get('width')).toBe('number');
    expect(typeof obj!.get('height')).toBe('number');
  });

  // TC-02: setTextSize XL applied; 'XXL' → false, no update (error path).
  it('TC-02: setTextSize valid key works, invalid key returns false with no update', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = setTextSize(doc, id, 'XL');
    expect(result).toBe(true);
    expect(objects.get(id)!.get('size')).toBe('XL');

    updateCount = 0;
    const badResult = setTextSize(doc, id, 'XXL');
    expect(badResult).toBe(false);
    expect(updateCount).toBe(0);
    expect(objects.get(id)!.get('size')).toBe('XL'); // unchanged
  });

  // TC-03: setTextWidthFixed(id, 30) → width clamped to TEXT_MIN_WIDTH_WORLD, widthMode 'fixed'.
  it('TC-03: setTextWidthFixed clamps to minimum and sets widthMode', () => {
    const id = createText(doc, { x: 10, y: 10 }, 'u1')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

    const result = setTextWidthFixed(doc, id, 30);
    expect(result).toBe(true);
    expect(objects.get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(objects.get(id)!.get('widthMode')).toBe('fixed');
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept.
  it('TC-04: isEmptyText and deleteIfEmpty', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

    // Empty text: isEmptyText returns true
    expect(isEmptyText(doc, id)).toBe(true);

    // deleteIfEmpty removes it
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objects.has(id)).toBe(false);

    // Whitespace-only text is NOT considered empty
    const id2 = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const ytext = getTextContent(doc, id2)!;
    doc.transact(() => { ytext.insert(0, '   '); }, LOCAL_ORIGIN);
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(objects.has(id2)).toBe(true);
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5001 → 5000; 4999+1 accepted (boundaries).
  it('TC-05: clampToLimit boundaries', () => {
    const long = 'a'.repeat(5001);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(5000);

    const ok = 'a'.repeat(4999);
    expect(clampToLimit(ok, TEXT_MAX_CHARS).length).toBe(4999);

    const exact = 'a'.repeat(5000);
    expect(clampToLimit(exact, TEXT_MAX_CHARS).length).toBe(5000);
  });

  // TC-06: non-finite create point → null, no transaction (error path).
  it('TC-06: createText with non-finite point returns null', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(createText(doc, { x: NaN, y: 0 }, 'u1')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'u1')).toBeNull();
    expect(createText(doc, { x: -Infinity, y: -Infinity }, 'u1')).toBeNull();
    expect(updateCount).toBe(0);
  });

  // Stale id for every setter → false, no update.
  it('stale id: setters return false', () => {
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(setTextSize(doc, 'nonexistent', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    expect(isEmptyText(doc, 'nonexistent')).toBe(false);
    expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false);
    expect(updateCount).toBe(0);
  });
});
