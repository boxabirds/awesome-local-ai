import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '@shared/board-model';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
} from '@shared/objects/text';
import {
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
} from '@shared/config';
import { clampToLimit } from '@shared/text-edit';

describe('text.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01: createText(doc,{100,50},'g_test') → type 'text', size M, widthMode 'auto', empty Y.Text, z above existing objects, createdBy 'g_test'
  describe('TC-01: createText', () => {
    it('creates a text object with correct defaults', () => {
      // First create a sticky so there's an existing object with z=1
      createSticky(doc, { x: 0, y: 0 });

      let updateCount = 0;
      doc.on('update', () => updateCount++);

      const id = createText(doc, { x: 100, y: 50 }, 'g_test');
      expect(id).not.toBeNull();
      expect(id!.length).toBeGreaterThan(0);

      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id!)!;
      expect(obj.get('type')).toBe('text');
      expect(obj.get('x')).toBe(100);
      expect(obj.get('y')).toBe(50);
      expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
      expect(obj.get('widthMode')).toBe('auto');
      expect((obj.get('text') as Y.Text).toString()).toBe('');
      expect(obj.get('z')).toBe(2); // above sticky's z=1
      expect(obj.get('createdBy')).toBe('g_test');
      expect(updateCount).toBe(1);
    });
  });

  // TC-02: setTextSize XL applied; 'XXL' → false and no update event (error path)
  describe('TC-02: setTextSize', () => {
    let id: string;

    beforeEach(() => {
      id = createText(doc, { x: 100, y: 100 }, 'test')!;
    });

    it('applies valid size XL', () => {
      const result = setTextSize(doc, id, 'XL');
      expect(result).toBe(true);
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      expect(objects.get(id)!.get('size')).toBe('XL');
    });

    it('rejects unknown size key and does not update', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const result = setTextSize(doc, id, 'XXL');
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    });

    it('rejects stale id', () => {
      const result = setTextSize(doc, 'nonexistent', 'L');
      expect(result).toBe(false);
    });
  });

  // TC-03: setTextWidthFixed(id, 30) → width TEXT_MIN_WIDTH_WORLD, widthMode 'fixed' (boundary)
  describe('TC-03: setTextWidthFixed', () => {
    let id: string;

    beforeEach(() => {
      id = createText(doc, { x: 100, y: 100 }, 'test')!;
    });

    it('clamps width below minimum to TEXT_MIN_WIDTH_WORLD', () => {
      const result = setTextWidthFixed(doc, id, 30);
      expect(result).toBe(true);
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      expect(objects.get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(objects.get(id)!.get('widthMode')).toBe('fixed');
    });

    it('accepts width above minimum', () => {
      setTextWidthFixed(doc, id, 200);
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      expect(objects.get(id)!.get('width')).toBe(200);
      expect(objects.get(id)!.get('widthMode')).toBe('fixed');
    });

    it('rejects non-finite width', () => {
      const result = setTextWidthFixed(doc, id, NaN);
      expect(result).toBe(false);
    });

    it('rejects stale id', () => {
      const result = setTextWidthFixed(doc, 'nonexistent', 100);
      expect(result).toBe(false);
    });
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only text is kept (negative)
  describe('TC-04: isEmptyText and deleteIfEmpty', () => {
    it('empty text → isEmptyText true, deleteIfEmpty removes', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;
      expect(isEmptyText(doc, id)).toBe(true);
      const deleted = deleteIfEmpty(doc, id);
      expect(deleted).toBe(true);
      expect(isEmptyText(doc, id)).toBe(true); // stale id returns true
    });

    it('whitespace-only text is kept (not empty)', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, '  ');
      expect(isEmptyText(doc, id)).toBe(false);
      const deleted = deleteIfEmpty(doc, id);
      expect(deleted).toBe(false);
      // Object still exists
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      expect(objects.has(id)).toBe(true);
    });

    it('non-empty text is kept', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'test')!;
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, 'hello');
      expect(isEmptyText(doc, id)).toBe(false);
      expect(deleteIfEmpty(doc, id)).toBe(false);
    });
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)
  describe('TC-05: clampToLimit boundaries', () => {
    it('clamps 5001 chars to 5000', () => {
      const input = 'a'.repeat(5001);
      const result = clampToLimit(input, 5000);
      expect(result.length).toBe(5000);
    });

    it('4999 + 1 = 5000 accepted (boundary)', () => {
      const input = 'a'.repeat(4999) + 'b';
      const result = clampToLimit(input, 5000);
      expect(result.length).toBe(5000);
    });

    it('5000 chars is unchanged', () => {
      const input = 'a'.repeat(5000);
      expect(clampToLimit(input, 5000).length).toBe(5000);
    });
  });

  // TC-06: non-finite create point → null, no transaction (error path)
  describe('TC-06: createText with non-finite point', () => {
    it('NaN x returns null, no transaction', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const id = createText(doc, { x: NaN, y: 100 }, 'test');
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('Infinity y returns null, no transaction', () => {
      let updateCount = 0;
      doc.on('update', () => updateCount++);
      const id = createText(doc, { x: 100, y: Infinity }, 'test');
      expect(id).toBeNull();
      expect(updateCount).toBe(0);
    });
  });

  // Additional: stale id for every setter → false, no update
  describe('stale id rejections', () => {
    it('setTextBox with stale id returns false', () => {
      const result = setTextBox(doc, 'nonexistent', { width: 100, height: 50 });
      expect(result).toBe(false);
    });
  });
});
