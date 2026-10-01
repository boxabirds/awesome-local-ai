import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';
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
import { TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD, DEFAULT_TEXT_SIZE } from '../../src/shared/config';

// Deterministic long text generator (stable across runs)
function makeLongText(n: number): string {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'pack', 'my', 'box', 'with', 'five', 'dozen', 'liquor', 'jugs', 'how', 'vexingly', 'daft', 'zebras'];
  let result = '';
  let i = 0;
  while (result.length < n) {
    result += words[i % words.length];
    if (result.length < n) result += ' ';
    i++;
  }
  return result.slice(0, n);
}

describe('text.model unit tests', () => {
  // TC-01: createText(100,50) → type text, size M, widthMode auto, empty Y.Text,
  // z above existing objects, createdBy set
  it('TC-01: createText creates a size M auto-width text at the point on top', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const stickyZ = snapshot(doc)[0].z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(obj).toBeInstanceOf(Y.Map);
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(obj.get('z')).toBeGreaterThan(stickyZ);

    const ytext = obj.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');

    // Initial box exists (estimate) so bounds are defined before first measure
    expect(typeof obj.get('width')).toBe('number');
    expect(typeof obj.get('height')).toBe('number');
    expect((obj.get('width') as number)).toBeGreaterThan(0);
    expect((obj.get('height') as number)).toBeGreaterThan(0);
  });

  // TC-02: setTextSize XL applied; 'XXL' → false, no update (error path)
  it('TC-02: setTextSize applies known sizes and rejects unknown keys', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(obj.get('size')).toBe('XL');

    let updated = false;
    obj.observe(() => {
      updated = true;
    });
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updated).toBe(false);
    expect(obj.get('size')).toBe('XL');
  });

  // TC-03: setTextWidthFixed 30 → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed
  it('TC-03: setTextWidthFixed clamps to the minimum and switches to fixed mode', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // A larger width is accepted as-is
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(obj.get('width')).toBe(250);
    expect(obj.get('widthMode')).toBe('fixed');
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes;
  // whitespace-only text is kept (only zero characters counts as empty)
  it('TC-04: empty text is removed on deleteIfEmpty; whitespace-only is kept', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);

    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id2)!.insert(0, '  ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').has(id2)).toBe(true);
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted
  it('TC-05: clampToLimit enforces TEXT_MAX_CHARS at the boundaries', () => {
    const over = makeLongText(TEXT_MAX_CHARS + 1);
    expect(over.length).toBe(TEXT_MAX_CHARS + 1);
    const clamped = clampToLimit(over, TEXT_MAX_CHARS);
    expect(clamped.length).toBe(TEXT_MAX_CHARS);
    expect(clamped).toBe(over.slice(0, TEXT_MAX_CHARS));

    // 4,999 + 1 = 5,000 accepted in full
    const atLimit = makeLongText(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);

    // Below the limit is untouched
    const under = makeLongText(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(under, TEXT_MAX_CHARS)).toBe(under);
  });

  // TC-06: non-finite create point → null, no transaction (error path)
  it('TC-06: non-finite create point returns null without a transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    let transactions = 0;
    doc.on('afterTransaction', () => {
      transactions++;
    });

    expect(createText(doc, { x: NaN, y: 0 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'g_test')).toBeNull();
    expect(createText(doc, { x: -Infinity, y: -Infinity }, 'g_test')).toBeNull();
    expect(transactions).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  // setTextBox updates width/height; non-finite values are rejected
  it('setTextBox stores the measured box and rejects non-finite values', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;

    expect(setTextBox(doc, id, { width: 123, height: 45.5 })).toBe(true);
    expect(obj.get('width')).toBe(123);
    expect(obj.get('height')).toBe(45.5);

    let updated = false;
    obj.observe(() => {
      updated = true;
    });
    expect(setTextBox(doc, id, { width: NaN, height: 5 })).toBe(false);
    expect(setTextBox(doc, id, { width: 5, height: Infinity })).toBe(false);
    expect(updated).toBe(false);
    expect(obj.get('width')).toBe(123);
    expect(obj.get('height')).toBe(45.5);
  });

  // Stale id for every setter → false, no update
  it('stale ids are rejected by every setter without an update', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 10, height: 10 })).toBe(false);
    expect(getTextContent(doc, 'missing')).toBeUndefined();
    expect(isEmptyText(doc, 'missing')).toBe(false);
    expect(deleteIfEmpty(doc, 'missing')).toBe(false);
    expect(doc.getMap('objects').size).toBe(0);
  });
});
