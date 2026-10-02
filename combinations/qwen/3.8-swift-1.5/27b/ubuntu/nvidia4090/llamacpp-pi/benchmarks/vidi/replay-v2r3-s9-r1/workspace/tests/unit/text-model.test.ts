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
import { objectMap } from '../../src/shared/board-model';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  doc.getMap('objects'); // ensure the map exists
});

describe('text.model', () => {
  // TC-01: createText at (100,50) → type 'text', size M, widthMode auto, empty Y.Text, z above existing, createdBy set
  describe('TC-01: createText', () => {
    it('creates a text object with correct schema', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'g_test');
      expect(id).not.toBeNull();
      const m = objectMap(doc, id!);
      expect(m).toBeDefined();
      expect(m!.get('type')).toBe('text');
      expect(m!.get('x')).toBe(100);
      expect(m!.get('y')).toBe(50);
      expect(m!.get('size')).toBe(DEFAULT_TEXT_SIZE);
      expect(m!.get('widthMode')).toBe('auto');
      expect(m!.get('createdBy')).toBe('g_test');
      const text = m!.get('text');
      expect(text).toBeInstanceOf(Y.Text);
      expect((text as Y.Text).length).toBe(0);
      // width and height should be set (initial estimate)
      expect(typeof m!.get('width')).toBe('number');
      expect(typeof m!.get('height')).toBe('number');
      // z should be set
      expect(typeof m!.get('z')).toBe('number');
    });

    it('places z above existing objects', () => {
      // Create a sticky-like object with z=5
      const objects = doc.getMap('objects');
      const m1 = new Y.Map<unknown>();
      m1.set('type', 'sticky');
      m1.set('z', 5);
      m1.set('x', 0);
      m1.set('y', 0);
      objects.set('existing-id', m1);

      const id = createText(doc, { x: 100, y: 50 }, 'g_test');
      const m = objectMap(doc, id!);
      expect(m!.get('z')).toBe(6);
    });
  });

  // TC-02: setTextSize XL → size XL; 'XXL' → false, no update
  describe('TC-02: setTextSize', () => {
    it('applies a valid size', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextSize(doc, id, 'XL')).toBe(true);
      const m = objectMap(doc, id);
      expect(m!.get('size')).toBe('XL');
    });

    it('rejects unknown size key', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextSize(doc, id, 'XXL')).toBe(false);
      const m = objectMap(doc, id);
      expect(m!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    });

    it('returns false for stale id', () => {
      expect(setTextSize(doc, 'nonexistent', 'XL')).toBe(false);
    });
  });

  // TC-03: setTextWidthFixed(30) → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed
  describe('TC-03: setTextWidthFixed', () => {
    it('clamps below minimum to TEXT_MIN_WIDTH_WORLD', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextWidthFixed(doc, id, 30)).toBe(true);
      const m = objectMap(doc, id);
      expect(m!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(m!.get('widthMode')).toBe('fixed');
    });

    it('accepts width at or above minimum', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextWidthFixed(doc, id, 200)).toBe(true);
      const m = objectMap(doc, id);
      expect(m!.get('width')).toBe(200);
      expect(m!.get('widthMode')).toBe('fixed');
    });

    it('returns false for non-finite width', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
      expect(setTextWidthFixed(doc, id, Infinity)).toBe(false);
    });

    it('returns false for stale id', () => {
      expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    });
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept
  describe('TC-04: isEmptyText / deleteIfEmpty', () => {
    it('isEmptyText is true for zero characters', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(isEmptyText(doc, id)).toBe(true);
    });

    it('isEmptyText is false for whitespace-only text', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const t = getTextContent(doc, id)!;
      t.insert(0, '  ');
      expect(isEmptyText(doc, id)).toBe(false);
    });

    it('deleteIfEmpty removes an empty text object', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(deleteIfEmpty(doc, id)).toBe(true);
      expect(objectMap(doc, id)).toBeUndefined();
    });

    it('deleteIfEmpty does not remove a non-empty text object', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const t = getTextContent(doc, id)!;
      t.insert(0, 'hello');
      expect(deleteIfEmpty(doc, id)).toBe(false);
      expect(objectMap(doc, id)).toBeDefined();
    });
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted
  describe('TC-05: clampToLimit', () => {
    it('truncates 5,001 chars to 5,000', () => {
      const long = 'a'.repeat(5001);
      expect(clampToLimit(long, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    });

    it('accepts 4,999 + 1 = 5,000 (boundary)', () => {
      const at = 'a'.repeat(4999) + 'b';
      expect(at).toHaveLength(5000);
      expect(clampToLimit(at, TEXT_MAX_CHARS)).toBe(at);
    });

    it('accepts text at exactly the limit', () => {
      const at = 'a'.repeat(5000);
      expect(clampToLimit(at, TEXT_MAX_CHARS)).toBe(at);
    });
  });

  // TC-06: non-finite create point → null, no transaction
  describe('TC-06: createText with non-finite point', () => {
    it('returns null for NaN coordinates', () => {
      expect(createText(doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
    });

    it('returns null for Infinity coordinates', () => {
      expect(createText(doc, { x: Infinity, y: 50 }, 'g_test')).toBeNull();
    });

    it('creates no object on failure', () => {
      createText(doc, { x: NaN, y: 50 }, 'g_test');
      const objects = doc.getMap('objects');
      let count = 0;
      for (const _ of objects.values()) count++;
      expect(count).toBe(0);
    });
  });

  // Stale id for every setter → false, no update
  describe('stale id handling', () => {
    it('setTextBox returns false for stale id', () => {
      expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    });

    it('setTextWidthFixed returns false for stale id', () => {
      expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
    });

    it('setTextSize returns false for stale id', () => {
      expect(setTextSize(doc, 'nonexistent', 'XL')).toBe(false);
    });
  });

  // setTextBox
  describe('setTextBox', () => {
    it('sets width and height', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextBox(doc, id, { width: 150, height: 30 })).toBe(true);
      const m = objectMap(doc, id);
      expect(m!.get('width')).toBe(150);
      expect(m!.get('height')).toBe(30);
    });

    it('returns false for non-finite values', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(setTextBox(doc, id, { width: NaN, height: 30 })).toBe(false);
      expect(setTextBox(doc, id, { width: 100, height: -1 })).toBe(true); // -1 is finite
    });
  });
});
