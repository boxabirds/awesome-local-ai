/**
 * Story 9 — text.model (unit, TC-01 to TC-06): the text object model against
 * a real Y.Doc: creation, size presets, fixed-width clamping, empty-text
 * removal, the 5,000-character limit and stale-id error paths.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  snapshot,
} from 'src/shared/board-model';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
} from 'src/shared/objects/text';
import { clampToLimit } from 'src/shared/text-edit';
import {
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
} from 'src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

/** Counts doc update events (transaction activity). */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => updates++);
  return () => updates;
}

describe('text.model (unit)', () => {
  it('TC-01: createText at (100,50) → type text, size M, auto width, empty Y.Text, z on top, createdBy set', () => {
    const doc = makeDoc();
    // A pre-existing sticky so the z-top and z-ordering rules are exercised.
    createSticky(doc, { x: 0, y: 0 }, 'yellow', 'existing');
    const stickyZ = snapshot(doc)[0].z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).toBeTruthy();

    const objects = doc.getMap('objects');
    const obj = objects.get(id)! as Y.Map<Record<string, unknown>>;
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(obj.get('z')).toBe(stickyZ + 1); // above the existing sticky
    const text = obj.get('text') as unknown as Y.Text;
    expect(text).toBeInstanceOf(Y.Text);
    expect(text.toString()).toBe('');
    // width/height are stored (estimate) so bounds exist before first measure.
    expect(typeof obj.get('width')).toBe('number');
    expect(typeof obj.get('height')).toBe('number');
  });

  it('TC-02: setTextSize XL applied; unknown key "XXL" → false and no update', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const obj = doc.getMap('objects').get(id)! as Y.Map<Record<string, unknown>>;
    expect(obj.get('size')).toBe('XL');
    expect(TEXT_SIZES.XL).toBe(56);

    const updates = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates()).toBe(0);
    expect(obj.get('size')).toBe('XL'); // unchanged
  });

  it('TC-03: setTextWidthFixed(30) clamps to TEXT_MIN_WIDTH_WORLD and sets fixed mode (boundary)', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const obj = doc.getMap('objects').get(id)! as Y.Map<Record<string, unknown>>;
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // Exactly the minimum is accepted unchanged.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false); // no-op
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-04: empty text (zero characters) → deleteIfEmpty removes; whitespace-only is kept', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').get(id)).toBeUndefined();

    // Whitespace-only is NOT empty (decision: only zero characters counts).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g')!;
    getTextContent(doc, id2)!.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').get(id2)).toBeInstanceOf(Y.Map);
  });

  it('TC-05: clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)', () => {
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    const base = 'a'.repeat(TEXT_MAX_CHARS - 1); // 4,999
    expect(clampToLimit(base + 'b', TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit(base + 'b', TEXT_MAX_CHARS)).toBe(base + 'b');
    // Below the limit is untouched.
    expect(clampToLimit('short', TEXT_MAX_CHARS)).toBe('short');
  });

  it('TC-06: non-finite create point → null and no transaction', () => {
    const doc = makeDoc();
    const updates = countUpdates(doc);

    expect(createText(doc, { x: NaN, y: 0 }, 'g')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'g')).toBeNull();
    expect(updates()).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('stale ids: every setter returns false without an update', () => {
    const doc = makeDoc();
    const updates = countUpdates(doc);

    expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 10, height: 10 })).toBe(false);
    expect(getTextContent(doc, 'missing')).toBeUndefined();
    expect(isEmptyText(doc, 'missing')).toBe(false);
    expect(deleteIfEmpty(doc, 'missing')).toBe(false);
    expect(updates()).toBe(0);
  });

  it('setTextBox writes the measured box; non-finite values rejected', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const obj = doc.getMap('objects').get(id)! as Y.Map<Record<string, unknown>>;

    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(true);
    expect(obj.get('width')).toBe(90);
    expect(obj.get('height')).toBe(26);

    const updates = countUpdates(doc);
    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(false); // no-op
    expect(setTextBox(doc, id, { width: NaN, height: 26 })).toBe(false);
    expect(updates()).toBe(0);
    expect(obj.get('width')).toBe(90);
  });
});
