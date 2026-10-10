// TC-01 to TC-06: the text object model. Creation fields and z, size
// validation, fixed-width clamping, empty-text deletion, the shared length
// clamp, rejection of non-finite placement and stale-id behaviour.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '../../src/shared/board-model';
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
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

function countUpdates(doc: Y.Doc, fn: () => unknown): { updates: number; result: unknown } {
  let updates = 0;
  const listener = () => updates++;
  doc.on('update', listener);
  try {
    const result = fn();
    return { updates, result };
  } finally {
    doc.off('update', listener);
  }
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

describe('text model', () => {
  it('TC-01: createText places a type text object at top z with defaults', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    if (typeof sticky !== 'string') throw new Error('sticky creation failed');
    const stickyZ = objectsMap(doc).get(sticky)!.get('z') as number;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(typeof id).toBe('string');

    const obj = objectsMap(doc).get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('text');
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
    expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj!.get('size')).toBe('M');
    expect(obj!.get('widthMode')).toBe('auto');
    const text = obj!.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    expect(obj!.get('createdBy')).toBe('g_test');
    expect(obj!.get('z') as number).toBeGreaterThan(stickyZ);
    // Finite estimate box exists before any measure.
    expect(Number.isFinite(obj!.get('width'))).toBe(true);
    expect(Number.isFinite(obj!.get('height'))).toBe(true);
  });

  it('TC-02: setTextSize accepts TEXT_SIZES keys and rejects others without writing', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(objectsMap(doc).get(id)!.get('size')).toBe('XL');

    const seen = countUpdates(doc, () => {
      expect(setTextSize(doc, id, 'XXL')).toBe(false);
    });
    expect(seen.updates).toBe(0);
    expect(objectsMap(doc).get(id)!.get('size')).toBe('XL');
    expect(TEXT_SIZES.XL).toBe(56);
  });

  it('TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and pins widthMode', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(obj.get('width')).toBe(120);
  });

  it('TC-04: deleteIfEmpty removes only zero-character texts', () => {
    const doc = freshDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectsMap(doc).has(empty)).toBe(false);

    const blank = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const text = getTextContent(doc, blank)!;
    doc.transact(() => text.insert(0, '  '));
    expect(isEmptyText(doc, blank)).toBe(false);
    expect(deleteIfEmpty(doc, blank)).toBe(false);
    expect(objectsMap(doc).has(blank)).toBe(true);
  });

  it('TC-05: clampToLimit accepts 5000 characters and trims beyond', () => {
    expect(clampToLimit('x'.repeat(5000), TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit('x'.repeat(5001), TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(TEXT_MAX_CHARS).toBe(5000);
  });

  it('TC-06: createText rejects non-finite placement without writing', () => {
    const doc = freshDoc();
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
    ]) {
      const seen = countUpdates(doc, () => {
        expect(createText(doc, at, 'g_test')).toBeNull();
      });
      expect(seen.updates).toBe(0);
    }
    expect(objectsMap(doc).size).toBe(0);
  });

  it('stale ids: every setter returns false and writes nothing', () => {
    const doc = freshDoc();
    const seen = countUpdates(doc, () => {
      expect(setTextSize(doc, 'gone', 'L')).toBe(false);
      expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false);
      expect(setTextBox(doc, 'gone', { width: 100, height: 100 })).toBe(false);
      expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    });
    expect(seen.updates).toBe(0);
    expect(getTextContent(doc, 'gone')).toBeUndefined();
    expect(isEmptyText(doc, 'gone')).toBe(false);
  });

  it('text height estimate uses TEXT_LINE_HEIGHT', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = objectsMap(doc).get(id)!;
    expect(obj.get('height')).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  });
});
