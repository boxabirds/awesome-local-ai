import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
} from '../../src/shared/config';
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

const objectsMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

describe('text.model', () => {
  it('TC-01 createText at {100,50} creates type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    const doc = new Y.Doc();
    // Create a sticky first to test z
    const stickyMap = new Y.Map<unknown>();
    stickyMap.set('type', 'sticky');
    stickyMap.set('x', 0);
    stickyMap.set('y', 0);
    stickyMap.set('z', 5);
    stickyMap.set('text', new Y.Text(''));
    objectsMap(doc).set('sticky-1', stickyMap);

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    expect(id).toBeTruthy();

    const map = objectsMap(doc).get(id!);
    expect(map).toBeDefined();
    expect(map!.get('type')).toBe('text');
    expect(map!.get('x')).toBe(100);
    expect(map!.get('y')).toBe(50);
    expect(map!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(map!.get('widthMode')).toBe('auto');
    expect(map!.get('createdBy')).toBe('g_test');
    expect(map!.get('z')).toBe(6); // above sticky z=5
    const text = map!.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
  });

  it('TC-02 setTextSize XL applied; "XXL" returns false with no update', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;

    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const map = objectsMap(doc).get(id)!;
    expect(map.get('size')).toBe('XL');

    const before = updateCount;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updateCount).toBe(before); // no transaction
  });

  it('TC-03 setTextWidthFixed 30 clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const map = objectsMap(doc).get(id)!;
    expect(map.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(map.get('widthMode')).toBe('fixed');
  });

  it('TC-03b setTextWidthFixed at exact minimum is accepted', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;

    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    const map = objectsMap(doc).get(id)!;
    expect(map.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(map.get('widthMode')).toBe('fixed');
  });

  it('TC-04 isEmptyText true for zero characters; deleteIfEmpty removes; whitespace-only is kept', () => {
    const doc = new Y.Doc();
    const id1 = createText(doc, { x: 0, y: 0 }, 'u1')!;
    expect(isEmptyText(doc, id1)).toBe(true);
    expect(deleteIfEmpty(doc, id1)).toBe(true);
    expect(objectsMap(doc).has(id1)).toBe(false);

    const id2 = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const ytext = getTextContent(doc, id2)!;
    ytext.insert(0, '   '); // whitespace-only
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(objectsMap(doc).has(id2)).toBe(true);
  });

  it('TC-05 clampToLimit with TEXT_MAX_CHARS: 5001 → 5000; 4999 + 1 accepted', () => {
    const long = 'a'.repeat(5001);
    expect(clampToLimit(long, TEXT_MAX_CHARS)).toHaveLength(5000);

    const at4999 = 'b'.repeat(4999);
    const result = clampToLimit(`${at4999}c`, TEXT_MAX_CHARS);
    expect(result).toHaveLength(5000);
    expect(result.endsWith('c')).toBe(true);
  });

  it('TC-06 non-finite create point returns null, no transaction', () => {
    const doc = new Y.Doc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    expect(createText(doc, { x: NaN, y: 0 }, 'u1')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'u1')).toBeNull();
    expect(createText(doc, { x: undefined as unknown as number, y: 0 }, 'u1')).toBeNull();
    expect(updateCount).toBe(0);
  });

  it('stale id for every setter returns false', () => {
    const doc = new Y.Doc();
    expect(setTextSize(doc, 'nonexistent', 'M')).toBe(false);
    expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    expect(isEmptyText(doc, 'nonexistent')).toBe(false);
    expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false);
  });
});
