import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '@shared/board-model';
import {
  createText, setTextSize, setTextWidthFixed, setTextBox,
  getTextContent, isEmptyText, deleteIfEmpty,
} from '@shared/objects/text';
import { clampToLimit } from '@shared/text-edit';
import {
  TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD, DEFAULT_TEXT_SIZE, TEXT_SIZES,
} from '@shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!obj) throw new Error(`object ${id} missing`);
  return obj as Y.Map<unknown>;
}

describe('text.model', () => {
  // TC-01: createText(100,50) → type text, size M, widthMode auto, empty
  // Y.Text, z above existing objects, createdBy set.
  it('TC-01: createText creates a size-M auto-width text at the point, above all objects', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const obj = objOf(doc, id!);
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    const text = obj.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(typeof obj.get('createdAt')).toBe('number');
    // z above the pre-existing sticky
    const sticky = objOf(doc, stickyId);
    expect((obj.get('z') as number)).toBeGreaterThan(sticky.get('z') as number);
  });

  // TC-02: setTextSize XL applied; 'XXL' → false and no update event.
  it('TC-02: setTextSize applies a known size and rejects an unknown one without a write', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = objOf(doc, id);

    let updates = 0;
    obj.observe(() => { updates++; });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(obj.get('size')).toBe('XL');
    expect(updates).toBe(1);

    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(obj.get('size')).toBe('XL');
    expect(updates).toBe(1);
  });

  // TC-03: setTextWidthFixed 30 → clamped to TEXT_MIN_WIDTH_WORLD, fixed mode.
  it('TC-03: setTextWidthFixed clamps below-minimum widths to the minimum', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const obj = objOf(doc, id);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // A width above the minimum is applied as-is.
    expect(setTextWidthFixed(doc, id, 123)).toBe(true);
    expect(objOf(doc, id).get('width')).toBe(123);
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes;
  // whitespace-only is kept (only zero characters counts as empty).
  it('TC-04: only zero characters counts as empty; deleteIfEmpty removes exactly then', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);

    // Whitespace-only text is NOT empty.
    getTextContent(doc, id)!.insert(0, '  ');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(doc.getMap('objects').has(id)).toBe(true);

    // Clear it → empty → removed.
    doc.transact(() => {
      getTextContent(doc, id)!.delete(0, 2);
    });
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted.
  it('TC-05: clampToLimit enforces the 5,000-character limit at the boundaries', () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe('a'.repeat(TEXT_MAX_CHARS));

    const atLimit = 'a'.repeat(TEXT_MAX_CHARS - 1) + 'b'; // 4,999 + 1
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  // TC-06: non-finite create point → null, no transaction.
  it('TC-06: createText with a non-finite point returns null without a transaction', () => {
    const doc = makeDoc();
    const transact = vi.spyOn(doc, 'transact');

    expect(createText(doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 100, y: Infinity }, 'g_test')).toBeNull();
    expect(createText(doc, { x: -Infinity, y: 0 }, 'g_test')).toBeNull();
    expect(transact).not.toHaveBeenCalled();
    expect(doc.getMap('objects').size).toBe(0);
  });

  // Stale id for every setter → false, no update.
  it('stale ids are rejected by every setter without a write', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = objOf(doc, id);
    let updates = 0;
    obj.observe(() => { updates++; });

    expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 10, height: 10 })).toBe(false);
    expect(deleteIfEmpty(doc, 'missing')).toBe(false);
    expect(updates).toBe(0);
  });

  it('setTextBox writes a finite box and rejects non-finite values', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = objOf(doc, id);

    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(26);

    expect(setTextBox(doc, id, { width: NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 120, height: Infinity })).toBe(false);
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(26);
  });

  it('getTextContent returns the Y.Text of a text object and undefined for others', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const content = getTextContent(doc, id);
    expect(content).toBeInstanceOf(Y.Text);

    // A sticky is not a text object: no text content, never "empty text".
    const stickyId = createSticky(doc, { x: 9, y: 9 });
    expect(getTextContent(doc, stickyId)).toBeUndefined();
    expect(isEmptyText(doc, stickyId)).toBe(false);
  });

  it('every TEXT_SIZES key is a valid size', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    for (const key of Object.keys(TEXT_SIZES)) {
      expect(setTextSize(doc, id, key)).toBe(true);
    }
  });
});
