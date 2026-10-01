// tests/unit/text-model.test.ts
// Unit tests for the text object model (TC-01 to TC-06).

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
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  return doc;
}

describe('text.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-01: createText creates a text object with correct defaults
  describe('TC-01: createText', () => {
    it('creates a text object at the given point with size M, auto width, empty text', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
      expect(id).toBeTruthy();

      const objects = doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj).toBeDefined();
      expect(obj.get('type')).toBe('text');
      expect(obj.get('x')).toBe(100);
      expect(obj.get('y')).toBe(50);
      expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
      expect(obj.get('widthMode')).toBe('auto');
      expect(obj.get('createdBy')).toBe('g_test');

      // Y.Text should be empty
      const ytext = obj.get('text') as Y.Text;
      expect(ytext.toString()).toBe('');

      // z should be above existing objects
      expect(obj.get('z')).toBeGreaterThan(0);
    });

    it('sets z above existing objects', () => {
      // Create a sticky first
      createSticky(doc, { x: 0, y: 0 });

      const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
      const objects = doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      const sticky = [...objects.entries()].find(([, o]) => (o as Y.Map<unknown>).get('type') === 'sticky')![1] as Y.Map<unknown>;

      expect(obj.get('z')).toBeGreaterThan(sticky.get('z') as number);
    });
  });

  // TC-02: setTextSize applies valid sizes, rejects unknown
  describe('TC-02: setTextSize', () => {
    it('applies XL size', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
      const result = setTextSize(doc, id, 'XL');
      expect(result).toBe(true);

      const objects = doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj.get('size')).toBe('XL');
    });

    it('rejects unknown size key with false and no update', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;

      // Listen for updates
      let updated = false;
      const objects = doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      obj.observe(() => { updated = true; });

      const result = setTextSize(doc, id, 'XXL');
      expect(result).toBe(false);
      expect(updated).toBe(false);
    });
  });

  // TC-03: setTextWidthFixed clamps to minimum
  describe('TC-03: setTextWidthFixed', () => {
    it('clamps width below TEXT_MIN_WIDTH_WORLD to the minimum', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
      const result = setTextWidthFixed(doc, id, 30);
      expect(result).toBe(true);

      const objects = doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(obj.get('widthMode')).toBe('fixed');
    });

    it('accepts width at or above minimum', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
      const result = setTextWidthFixed(doc, id, 200);
      expect(result).toBe(true);

      const objects = doc.getMap('objects');
      const obj = objects.get(id) as Y.Map<unknown>;
      expect(obj.get('width')).toBe(200);
      expect(obj.get('widthMode')).toBe('fixed');
    });
  });

  // TC-04: isEmptyText and deleteIfEmpty
  describe('TC-04: isEmptyText and deleteIfEmpty', () => {
    it('isEmptyText is true for zero characters', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
      expect(isEmptyText(doc, id)).toBe(true);
    });

    it('deleteIfEmpty removes an empty text object', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
      const result = deleteIfEmpty(doc, id);
      expect(result).toBe(true);

      const objects = doc.getMap('objects');
      expect(objects.get(id)).toBeUndefined();
    });

    it('whitespace-only text is kept (negative: only zero characters counts as empty)', () => {
      const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, '  ');

      expect(isEmptyText(doc, id)).toBe(false);
      const result = deleteIfEmpty(doc, id);
      expect(result).toBe(false);

      const objects = doc.getMap('objects');
      expect(objects.get(id)).toBeDefined();
    });
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS
  describe('TC-05: clampToLimit boundaries', () => {
    it('clamps 5001 chars to 5000', () => {
      const long = 'a'.repeat(5001);
      const result = clampToLimit(long, TEXT_MAX_CHARS);
      expect(result.length).toBe(5000);
      expect(result).toBe('a'.repeat(5000));
    });

    it('accepts 4999 + 1 = 5000', () => {
      const text4999 = 'a'.repeat(4999);
      const result = clampToLimit(text4999 + 'b', TEXT_MAX_CHARS);
      expect(result.length).toBe(5000);
      expect(result).toBe('a'.repeat(4999) + 'b');
    });
  });

  // TC-06: non-finite create point returns null
  describe('TC-06: non-finite create point', () => {
    it('returns null for NaN coordinates', () => {
      const result = createText(doc, { x: NaN, y: 50 }, 'g_test');
      expect(result).toBeNull();
    });

    it('returns null for Infinity coordinates', () => {
      const result = createText(doc, { x: Infinity, y: 50 }, 'g_test');
      expect(result).toBeNull();
    });

    it('no object is created for non-finite point', () => {
      createText(doc, { x: NaN, y: NaN }, 'g_test');
      const objects = doc.getMap('objects');
      expect(objects.size).toBe(0);
    });
  });

  // Stale id for every setter → false
  describe('stale id rejection', () => {
    it('setTextSize returns false for non-existent id', () => {
      expect(setTextSize(doc, 'nonexistent', 'XL')).toBe(false);
    });

    it('setTextWidthFixed returns false for non-existent id', () => {
      expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    });

    it('setTextBox returns false for non-existent id', () => {
      expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    });

    it('getTextContent returns undefined for non-existent id', () => {
      expect(getTextContent(doc, 'nonexistent')).toBeUndefined();
    });

    it('isEmptyText returns false for non-existent id', () => {
      expect(isEmptyText(doc, 'nonexistent')).toBe(false);
    });

    it('deleteIfEmpty returns false for non-existent id', () => {
      expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false);
    });
  });
});
