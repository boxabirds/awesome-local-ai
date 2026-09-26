import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
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
import { initDoc, LOCAL_ORIGIN, createSticky } from '../../src/shared/board-model';
import { clampToLimit } from '../../src/shared/text-edit';

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('text model (TC-01 to TC-06)', () => {
  describe('TC-01 createText', () => {
    it('creates a text object with correct schema', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 100, y: 50 }, 'g_test');
      expect(id).not.toBeNull();
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id!);
      expect(obj).toBeInstanceOf(Y.Map);
      expect(obj!.get('type')).toBe('text');
      expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
      expect(obj!.get('widthMode')).toBe('auto');
      expect(obj!.get('createdBy')).toBe('g_test');
      expect(obj!.get('x')).toBe(100);
      expect(obj!.get('y')).toBe(50);
      const text = obj!.get('text');
      expect(text).toBeInstanceOf(Y.Text);
      expect((text as Y.Text).length).toBe(0);
    });

    it('z is above existing objects', () => {
      const doc = createDoc();
      createSticky(doc, { x: 0, y: 0 });
      const id = createText(doc, { x: 10, y: 10 }, 'me');
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id!);
      expect((obj!.get('z') as number)).toBeGreaterThan(1);
    });
  });

  describe('TC-02 setTextSize', () => {
    it('applies XL size', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      const result = setTextSize(doc, id, 'XL');
      expect(result).toBe(true);
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
      expect(obj!.get('size')).toBe('XL');
    });

    it('rejects unknown size with false', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      const result = setTextSize(doc, id, 'XXL');
      expect(result).toBe(false);
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
      expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    });

    it('rejects stale id with false', () => {
      const doc = createDoc();
      expect(setTextSize(doc, 'nonexistent', 'M')).toBe(false);
    });
  });

  describe('TC-03 setTextWidthFixed', () => {
    it('clamps to TEXT_MIN_WIDTH_WORLD', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      const result = setTextWidthFixed(doc, id, 30);
      expect(result).toBe(true);
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
      expect(obj!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(obj!.get('widthMode')).toBe('fixed');
    });

    it('accepts width above minimum', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      const result = setTextWidthFixed(doc, id, 200);
      expect(result).toBe(true);
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
      expect(obj!.get('width')).toBe(200);
    });

    it('rejects non-finite width', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
      expect(setTextWidthFixed(doc, id, Infinity)).toBe(false);
    });
  });

  describe('TC-04 isEmptyText and deleteIfEmpty', () => {
    it('isEmptyText true for zero characters', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      expect(isEmptyText(doc, id)).toBe(true);
    });

    it('deleteIfEmpty removes when zero characters', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      expect(deleteIfEmpty(doc, id)).toBe(true);
      expect(doc.getMap<Y.Map<unknown>>('objects').get(id)).toBeUndefined();
    });

    it('whitespace-only text is kept', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      const text = getTextContent(doc, id)!;
      text.insert(0, '   \n  ');
      expect(deleteIfEmpty(doc, id)).toBe(false);
      expect(doc.getMap<Y.Map<unknown>>('objects').get(id)).toBeDefined();
    });

    it('deleteIfEmpty returns false for stale id', () => {
      const doc = createDoc();
      expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false);
    });
  });

  describe('TC-05 clampToLimit with TEXT_MAX_CHARS', () => {
    it('clamps 5001 chars to 5000', () => {
      const long = 'a'.repeat(5001);
      const clamped = clampToLimit(long, TEXT_MAX_CHARS);
      expect(clamped.length).toBe(TEXT_MAX_CHARS);
    });

    it('4999 + 1 chars accepted (under limit)', () => {
      const under = 'b'.repeat(4999);
      const result = clampToLimit(under, TEXT_MAX_CHARS);
      expect(result.length).toBe(4999);
    });

    it('exactly 5000 is unchanged', () => {
      const exact = 'c'.repeat(TEXT_MAX_CHARS);
      expect(clampToLimit(exact, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    });
  });

  describe('TC-06 createText with non-finite point', () => {
    it('returns null and no update for non-finite x', () => {
      const doc = createDoc();
      let updateCount = 0;
      doc.on('update', () => { updateCount++; });
      const result = createText(doc, { x: Number.NaN, y: 0 }, 'me');
      expect(result).toBeNull();
      expect(updateCount).toBe(0);
    });

    it('returns null for Infinity coordinates', () => {
      const doc = createDoc();
      const result = createText(doc, { x: Infinity, y: 10 }, 'me');
      expect(result).toBeNull();
    });
  });

  describe('setTextBox', () => {
    it('writes box when different', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      const result = setTextBox(doc, id, { width: 200, height: 50 });
      expect(result).toBe(true);
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
      expect(obj!.get('width')).toBe(200);
      expect(obj!.get('height')).toBe(50);
    });

    it('returns false for non-finite', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      expect(setTextBox(doc, id, { width: NaN, height: 10 })).toBe(false);
    });

    it('returns false when box is identical', () => {
      const doc = createDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'me')!;
      // Read initial box
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
      const w = obj.get('width') as number;
      const h = obj.get('height') as number;
      expect(setTextBox(doc, id, { width: w, height: h })).toBe(false);
    });

    it('rejects stale id', () => {
      const doc = createDoc();
      expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
    });
  });
});