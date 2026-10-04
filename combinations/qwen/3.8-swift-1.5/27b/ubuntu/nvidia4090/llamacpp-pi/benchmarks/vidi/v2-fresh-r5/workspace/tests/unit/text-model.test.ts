/**
 * Unit tests for the text object model (TC-01 to TC-06).
 * Tests the schema rules and validation against a real Y.Doc.
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
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
import { createSticky, LOCAL_ORIGIN } from '../../src/shared/board-model';

describe('text model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getMap('objects');
  });

  // TC-01: createText creates a text object with correct defaults
  describe('TC-01: createText', () => {
    it('creates a text object with type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
      // Create a sticky first to establish a z baseline
      const stickyId = createSticky(doc, { x: 0, y: 0 });
      expect(stickyId).toBeTruthy();

      const id = createText(doc, { x: 100, y: 50 }, 'g_test');
      expect(id).toBeTypeOf('string');
      expect(id!.length).toBeGreaterThan(0);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id!);
      expect(obj).toBeDefined();
      expect(obj!.get('type')).toBe('text');
      expect(obj!.get('x')).toBe(100);
      expect(obj!.get('y')).toBe(50);
      expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
      expect(obj!.get('widthMode')).toBe('auto');
      expect(obj!.get('createdBy')).toBe('g_test');

      // Y.Text should be empty
      const ytext = obj!.get('text') as Y.Text;
      expect(ytext.toString()).toBe('');

      // z should be above the sticky
      const stickyObj = objects.get(stickyId);
      const textZ = obj!.get('z') as number;
      const stickyZ = stickyObj!.get('z') as number;
      expect(textZ).toBeGreaterThan(stickyZ);
    });
  });

  // TC-02: setTextSize
  describe('TC-02: setTextSize', () => {
    it('applies a valid size', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextSize(doc, id, 'XL');
      expect(result).toBe(true);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id);
      expect(obj!.get('size')).toBe('XL');
    });

    it('rejects unknown size keys (XXL)', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextSize(doc, id, 'XXL');
      expect(result).toBe(false);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id);
      expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    });

    it('rejects stale id', () => {
      const result = setTextSize(doc, 'nonexistent', 'XL');
      expect(result).toBe(false);
    });
  });

  // TC-03: setTextWidthFixed
  describe('TC-03: setTextWidthFixed', () => {
    it('clamps width below TEXT_MIN_WIDTH_WORLD to the minimum', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextWidthFixed(doc, id, 30);
      expect(result).toBe(true);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id);
      expect(obj!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(obj!.get('widthMode')).toBe('fixed');
    });

    it('accepts width above minimum', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextWidthFixed(doc, id, 200);
      expect(result).toBe(true);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id);
      expect(obj!.get('width')).toBe(200);
      expect(obj!.get('widthMode')).toBe('fixed');
    });

    it('rejects non-finite width', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextWidthFixed(doc, id, NaN);
      expect(result).toBe(false);
    });

    it('rejects stale id', () => {
      const result = setTextWidthFixed(doc, 'nonexistent', 100);
      expect(result).toBe(false);
    });
  });

  // TC-04: isEmptyText and deleteIfEmpty
  describe('TC-04: isEmptyText and deleteIfEmpty', () => {
    it('isEmptyText is true for zero characters', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      expect(isEmptyText(doc, id)).toBe(true);
    });

    it('isEmptyText is false for non-empty text', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => {
        ytext.insert(0, 'hello');
      }, LOCAL_ORIGIN);
      expect(isEmptyText(doc, id)).toBe(false);
    });

    it('whitespace-only text is NOT empty (negative)', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => {
        ytext.insert(0, '  ');
      }, LOCAL_ORIGIN);
      expect(isEmptyText(doc, id)).toBe(false);
    });

    it('deleteIfEmpty removes empty text object', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = deleteIfEmpty(doc, id);
      expect(result).toBe(true);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      expect(objects.has(id)).toBe(false);
    });

    it('deleteIfEmpty does not remove non-empty text', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => {
        ytext.insert(0, 'hello');
      }, LOCAL_ORIGIN);
      const result = deleteIfEmpty(doc, id);
      expect(result).toBe(false);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      expect(objects.has(id)).toBe(true);
    });
  });

  // TC-05: clampToLimit boundaries
  describe('TC-05: clampToLimit', () => {
    it('accepts text at exactly TEXT_MAX_CHARS', () => {
      const text = 'a'.repeat(TEXT_MAX_CHARS);
      expect(clampToLimit(text, TEXT_MAX_CHARS)).toBe(text);
    });

    it('truncates text at TEXT_MAX_CHARS + 1', () => {
      const text = 'a'.repeat(TEXT_MAX_CHARS + 1);
      const result = clampToLimit(text, TEXT_MAX_CHARS);
      expect(result).toBe('a'.repeat(TEXT_MAX_CHARS));
      expect(result.length).toBe(TEXT_MAX_CHARS);
    });

    it('accepts text just under the limit (4999)', () => {
      const text = 'a'.repeat(TEXT_MAX_CHARS - 1);
      expect(clampToLimit(text, TEXT_MAX_CHARS)).toBe(text);
    });
  });

  // TC-06: non-finite create point
  describe('TC-06: createText with non-finite point', () => {
    it('returns null for NaN coordinates', () => {
      const result = createText(doc, { x: NaN, y: 0 }, 'g_test');
      expect(result).toBeNull();
    });

    it('returns null for Infinity coordinates', () => {
      const result = createText(doc, { x: Infinity, y: 0 }, 'g_test');
      expect(result).toBeNull();
    });

    it('does not create an object in the doc', () => {
      const result = createText(doc, { x: NaN, y: NaN }, 'g_test');
      expect(result).toBeNull();

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      let count = 0;
      objects.forEach(() => count++);
      expect(count).toBe(0);
    });
  });

  // Stale id for every setter
  describe('stale id rejection', () => {
    it('setTextBox rejects stale id', () => {
      const result = setTextBox(doc, 'nonexistent', { width: 100, height: 50 });
      expect(result).toBe(false);
    });

    it('setTextWidthFixed rejects stale id', () => {
      const result = setTextWidthFixed(doc, 'nonexistent', 100);
      expect(result).toBe(false);
    });

    it('setTextSize rejects stale id', () => {
      const result = setTextSize(doc, 'nonexistent', 'M');
      expect(result).toBe(false);
    });
  });

  // setTextBox basic
  describe('setTextBox', () => {
    it('sets width and height', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextBox(doc, id, { width: 120, height: 30 });
      expect(result).toBe(true);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id);
      expect(obj!.get('width')).toBe(120);
      expect(obj!.get('height')).toBe(30);
    });

    it('rejects non-finite values', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const result = setTextBox(doc, id, { width: NaN, height: 30 });
      expect(result).toBe(false);
    });
  });
});
