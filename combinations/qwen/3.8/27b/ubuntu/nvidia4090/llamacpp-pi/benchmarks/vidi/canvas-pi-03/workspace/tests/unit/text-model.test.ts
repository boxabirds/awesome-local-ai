import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  objectSnapshot,
  ensureMeta,
} from '@/shared/board-model';
import {
  createText,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
} from '@/shared/objects/text';
import { applyTextDiff, clampToLimit } from '@/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '@/shared/config';

function textOf(doc: Y.Doc, id: string): string {
  const t = getTextContent(doc, id);
  return t === undefined ? '<missing>' : t.toString();
}

function rawField(doc: Y.Doc, id: string, field: string): unknown {
  const record = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  return record?.get(field);
}

describe('story 9: text object model (text.model)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    ensureMeta(doc);
  });

  describe('TC-01: createText', () => {
    it('creates a size M, auto-width text object at the click point with the creator id', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
      expect(id).toBeTypeOf('string');
      const snap = objectSnapshot(doc).find((o) => o.id === id);
      expect(snap).toMatchObject({
        type: 'text',
        x: 100,
        y: 50,
        size: DEFAULT_TEXT_SIZE,
        widthMode: 'auto',
        createdBy: 'g_test',
      });
      expect(textOf(doc, id)).toBe('');
      // The object sits on top (z above any existing object).
      const z = rawField(doc, id, 'z');
      expect(typeof z).toBe('number');
      expect(z as number).toBeGreaterThan(0);
    });

    it('stacks new text above existing objects', () => {
      const sticky = createSticky(doc, { x: 0, y: 0 });
      const before = rawField(doc, sticky, 'z') as number;
      const id = createText(doc, { x: 5, y: 5 }, 'g_test');
      const after = rawField(doc, id as string, 'z') as number;
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('TC-02: setTextSize', () => {
    it('applies a known size', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test');
      expect(setTextSize(doc, id as string, 'XL')).toBe(true);
      const snap = objectSnapshot(doc).find((o) => o.id === id);
      expect(snap?.size).toBe('XL');
    });

    it('rejects an unknown key with no update', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const observed: unknown[] = [];
      (doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.observe((ev) => observed.push(ev));
      expect(setTextSize(doc, id, 'XXL' as never)).toBe(false);
      expect(observed).toHaveLength(0);
    });
  });

  describe('TC-03: setTextWidthFixed', () => {
    it('clamps below TEXT_MIN_WIDTH_WORLD to the minimum', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test');
      expect(setTextWidthFixed(doc, id as string, 30)).toBe(true);
      expect(rawField(doc, id as string, 'width')).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(rawField(doc, id as string, 'widthMode')).toBe('fixed');
    });

    it('stores an in-range width unchanged', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test');
      expect(setTextWidthFixed(doc, id as string, 120)).toBe(true);
      expect(rawField(doc, id as string, 'width')).toBe(120);
      expect(rawField(doc, id as string, 'widthMode')).toBe('fixed');
    });

    it('rejects non-finite widths with no update', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const observed: unknown[] = [];
      (doc.getMap('objects').get(id) as Y.Map<unknown> | undefined)?.observe((ev) => observed.push(ev));
      expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
      expect(observed).toHaveLength(0);
    });
  });

  describe('TC-04: isEmptyText / deleteIfEmpty', () => {
    it('removes a zero-character text object', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test');
      expect(isEmptyText(doc, id as string)).toBe(true);
      expect(deleteIfEmpty(doc, id as string)).toBe(true);
      expect(objectSnapshot(doc).find((o) => o.id === id)).toBeUndefined();
    });

    it('keeps whitespace-only text (negative)', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test');
      const ytext = getTextContent(doc, id as string);
      doc.transact(() => ytext?.insert(0, '   '), LOCAL_ORIGIN);
      expect(isEmptyText(doc, id as string)).toBe(false);
      expect(deleteIfEmpty(doc, id as string)).toBe(false);
      expect(objectSnapshot(doc).find((o) => o.id === id)).toBeDefined();
    });
  });

  describe('TC-05: clampToLimit (TEXT_MAX_CHARS boundaries)', () => {
    it('clamps 5,001 characters to 5,000', () => {
      const long = 'a'.repeat(TEXT_MAX_CHARS + 1);
      expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    });

    it('accepts 4,999 + 1 characters (the 5,000th is kept)', () => {
      const base = 'a'.repeat(TEXT_MAX_CHARS - 1); // 4,999
      expect(clampToLimit(base + 'b', TEXT_MAX_CHARS)).toBe(base + 'b'); // 5,000 kept
      expect(clampToLimit(base + 'b' + 'c', TEXT_MAX_CHARS)).toBe(base + 'b'); // 5,001 clamped
    });

    it('accepts exactly the limit', () => {
      const exact = 'a'.repeat(TEXT_MAX_CHARS);
      expect(clampToLimit(exact, TEXT_MAX_CHARS)).toBe(exact);
    });
  });

  describe('TC-06: createText error paths', () => {
    it('returns null for non-finite coordinates without a transaction', () => {
      expect(createText(doc, { x: Number.NaN, y: 10 }, 'g_test')).toBeNull();
      expect(createText(doc, { x: 10, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
      expect(objectSnapshot(doc)).toHaveLength(0);
    });
  });

  describe('stale ids and helpers', () => {
    it('every setter rejects a stale id with no update', () => {
      const observed: unknown[] = [];
      doc.getMap('objects').observe((ev) => observed.push(ev));
      expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
      expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
      expect(setTextBox(doc, 'missing', { width: 10, height: 10 })).toBe(false);
      expect(deleteIfEmpty(doc, 'missing')).toBe(false);
      expect(observed).toHaveLength(0);
    });

    it('setters reject a sticky id (type check)', () => {
      const sticky = createSticky(doc, { x: 0, y: 0 });
      expect(setTextSize(doc, sticky, 'XL')).toBe(false);
      expect(setTextWidthFixed(doc, sticky, 100)).toBe(false);
      expect(getTextContent(doc, sticky)).toBeUndefined();
    });

    it('applyTextDiff writes a minimal diff through its own transaction', () => {
      const id = createText(doc, { x: 0, y: 0 }, 'g_test');
      const ytext = getTextContent(doc, id as string);
      expect(ytext).toBeDefined();
      applyTextDiff(ytext as Y.Text, 'hello', LOCAL_ORIGIN);
      expect(ytext?.toString()).toBe('hello');
      applyTextDiff(ytext as Y.Text, 'hello world', LOCAL_ORIGIN);
      expect(ytext?.toString()).toBe('hello world');
      applyTextDiff(ytext as Y.Text, 'hell', LOCAL_ORIGIN);
      expect(ytext?.toString()).toBe('hell');
    });

    it('TEXT_SIZES exposes the four presets (S < M < L < XL)', () => {
      expect(Object.keys(TEXT_SIZES).sort()).toEqual(['L', 'M', 'S', 'XL']);
      expect(TEXT_SIZES.S).toBeLessThan(TEXT_SIZES.M);
      expect(TEXT_SIZES.M).toBeLessThan(TEXT_SIZES.L);
      expect(TEXT_SIZES.L).toBeLessThan(TEXT_SIZES.XL);
    });
  });
});
