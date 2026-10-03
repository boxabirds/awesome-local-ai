// Unit tests for the text object model (text.model contract).
// TC-01 to TC-06 + stale-id rejections.

import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  return doc;
}

/** Create a sticky note so the doc has an existing object to layer z on. */
function createStickyAt(doc: Y.Doc, x: number, y: number): string {
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const objects = doc.getMap('objects');
    const note = new Y.Map();
    note.set('type', 'sticky');
    note.set('x', x);
    note.set('y', y);
    note.set('color', 'yellow');
    note.set('text', text);
    note.set('z', 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  });
  return id;
}

describe('text.model', () => {
  // TC-01: createText → type 'text', size M, widthMode 'auto', empty Y.Text,
  // z above existing objects, createdBy set, top-left at the given point.
  test('TC-01 createText creates a size-M auto-width text at the point', () => {
    const doc = makeDoc();
    createStickyAt(doc, 0, 0);

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const tid = id as string;
    const obj = objects.get(tid) as Y.Map<unknown>;
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    // z above every existing object (sticky has z=1).
    expect(obj.get('z')).toBeGreaterThan(1);
    // Empty Y.Text.
    const ytext = obj.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');
    // A box exists before the first measure.
    expect(typeof obj.get('width')).toBe('number');
    expect(typeof obj.get('height')).toBe('number');
  });

  // TC-02: setTextSize XL applied; unknown key 'XXL' → false, no update.
  test('TC-02 setTextSize applies known sizes and rejects unknown keys', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id) as Y.Map<unknown>;

    // Observe updates to detect a (forbidden) write on the error path.
    let updateEvents = 0;
    obj.observe(() => {
      updateEvents++;
    });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(obj.get('size')).toBe('XL');

    const eventsAfterXl = updateEvents;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(obj.get('size')).toBe('XL');
    expect(updateEvents).toBe(eventsAfterXl);
  });

  // TC-03: setTextWidthFixed(30) → clamped to TEXT_MIN_WIDTH_WORLD, mode fixed.
  test('TC-03 setTextWidthFixed clamps to the minimum width and sets fixed mode', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id) as Y.Map<unknown>;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(obj.get('widthMode')).toBe('fixed');
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);

    // A width above the minimum is applied as-is.
    expect(setTextWidthFixed(doc, id, 150)).toBe(true);
    expect(obj.get('width')).toBe(150);
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes;
  // whitespace-only text is kept (only zero characters counts as empty).
  test('TC-04 isEmptyText is true only for zero characters; deleteIfEmpty removes', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    const objects = doc.getMap('objects') as Y.Map<unknown>;
    expect(objects.has(id)).toBe(false);

    // Whitespace-only text is kept.
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext2 = getTextContent(doc, id2)!;
    ytext2.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect((doc.getMap('objects') as Y.Map<unknown>).has(id2)).toBe(true);
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted.
  test('TC-05 clampToLimit enforces the 5,000-character limit at the boundaries', () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe('a'.repeat(TEXT_MAX_CHARS));

    const under = 'b'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(under + 'c', TEXT_MAX_CHARS)).toBe(under + 'c');
    expect(clampToLimit(under + 'c', TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
  });

  // TC-06: non-finite create point → null, no transaction.
  test('TC-06 createText with a non-finite point returns null and writes nothing', () => {
    const doc = makeDoc();
    let updateEvents = 0;
    const objects = doc.getMap('objects');
    objects.observeDeep(() => {
      updateEvents++;
    });

    expect(createText(doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 100, y: Infinity }, 'g_test')).toBeNull();
    expect(objects.size).toBe(0);
    expect(updateEvents).toBe(0);
  });

  // Stale id: every setter rejects without a transaction.
  test('stale ids are rejected by every setter without a transaction', () => {
    const doc = makeDoc();
    let updateEvents = 0;
    doc.getMap('objects').observeDeep(() => {
      updateEvents++;
    });

    expect(setTextSize(doc, 'nope', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    expect(setTextBox(doc, 'nope', { width: 10, height: 10 })).toBe(false);
    expect(getTextContent(doc, 'nope')).toBeUndefined();
    expect(isEmptyText(doc, 'nope')).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
    expect(updateEvents).toBe(0);
  });

  // setTextBox: applies a box; non-finite values are rejected.
  test('setTextBox applies finite boxes and rejects non-finite values', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id) as Y.Map<unknown>;

    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(26);

    expect(setTextBox(doc, id, { width: NaN, height: 26 })).toBe(false);
    expect(obj.get('width')).toBe(120);
  });

  // A fixed-width text can go back to auto width only via typing re-measure
  // (setTextBox does not change widthMode); setTextWidthFixed keeps fixed mode.
  test('setTextWidthFixed keeps widthMode fixed; width stays clamped at the boundary', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(id) as Y.Map<unknown>;

    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');
    void TEXT_MAX_AUTO_WIDTH_WORLD;
  });
});
