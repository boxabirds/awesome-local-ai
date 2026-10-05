import { describe, it, expect } from 'vitest';
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
import { createSticky } from '../../src/shared/board-model';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_WORLD,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  return new Y.Doc();
}

function textObj(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!obj) throw new Error(`text object ${id} not found`);
  return obj as Y.Map<unknown>;
}

describe('text.model (unit, real Y.Doc)', () => {
  it('TC-01: createText(100,50) → type text, size M, auto, empty Y.Text, z top, createdBy set', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const sticky = doc.getMap('objects').get(stickyId) as Y.Map<unknown>;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const obj = textObj(doc, id!);
    expect(obj.get('type')).toBe('text');
    // Top-left at the clicked point
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    const text = obj.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(obj.get('z')).toBeGreaterThan(sticky.get('z') as number);
    // Stored box exists before the first measure (one empty line)
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(obj.get('width')).toBeGreaterThanOrEqual(TEXT_PADDING_WORLD);
  });

  it('TC-02: setTextSize XL applied; unknown size → false and no update (error path)', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    const obj = textObj(doc, id);

    let updates = 0;
    obj.observe(() => {
      updates++;
    });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(obj.get('size')).toBe('XL');
    expect(updates).toBe(1);

    // Unknown size key: rejected, no transaction
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates).toBe(1);
    expect(obj.get('size')).toBe('XL');
    // Stale id: rejected
    expect(setTextSize(doc, 'stale', 'XL')).toBe(false);
    expect(updates).toBe(1);
  });

  it('TC-03: setTextWidthFixed(30) → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    const obj = textObj(doc, id);

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // A width above the minimum is kept as-is
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(obj.get('width')).toBe(250);
    // Non-finite: rejected
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
    expect(obj.get('width')).toBe(250);
    // Stale id: rejected
    expect(setTextWidthFixed(doc, 'stale', 100)).toBe(false);
  });

  it('TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept', () => {
    const doc = makeDoc();

    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);

    // Whitespace-only is NOT empty (zero characters only counts as empty)
    const id2 = createText(doc, { x: 0, y: 0 }, 'u')!;
    getTextContent(doc, id2)!.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').has(id2)).toBe(true);

    // Non-empty text is kept
    const id3 = createText(doc, { x: 0, y: 0 }, 'u')!;
    getTextContent(doc, id3)!.insert(0, 'x');
    expect(deleteIfEmpty(doc, id3)).toBe(false);
    expect(doc.getMap('objects').has(id3)).toBe(true);
  });

  it('TC-05: clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)', () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe('a'.repeat(TEXT_MAX_CHARS));
    expect(clampToLimit(over, TEXT_MAX_CHARS).length).toBe(5000);

    const atLimit = 'a'.repeat(4999) + 'b';
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);

    // Under the limit is untouched
    expect(clampToLimit('hello', TEXT_MAX_CHARS)).toBe('hello');
  });

  it('TC-06: non-finite create point → null, no transaction (error path)', () => {
    const doc = makeDoc();

    expect(createText(doc, { x: NaN, y: 0 }, 'u')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'u')).toBeNull();
    expect(createText(doc, { x: -Infinity, y: 10 }, 'u')).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('stale id for every setter → false, no update', () => {
    const doc = makeDoc();
    expect(setTextWidthFixed(doc, 'stale', 100)).toBe(false);
    expect(setTextBox(doc, 'stale', { width: 10, height: 10 })).toBe(false);
    expect(getTextContent(doc, 'stale')).toBeUndefined();
    expect(isEmptyText(doc, 'stale')).toBe(false);
    expect(deleteIfEmpty(doc, 'stale')).toBe(false);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('setTextBox writes the stored box; unchanged box → no transaction', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    const obj = textObj(doc, id);

    let updates = 0;
    obj.observe(() => {
      updates++;
    });

    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(52);
    expect(updates).toBe(1);

    // Same box again → no write
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(false);
    expect(updates).toBe(1);
    // Non-finite → rejected
    expect(setTextBox(doc, id, { width: NaN, height: 10 })).toBe(false);
    expect(updates).toBe(1);
  });
});
