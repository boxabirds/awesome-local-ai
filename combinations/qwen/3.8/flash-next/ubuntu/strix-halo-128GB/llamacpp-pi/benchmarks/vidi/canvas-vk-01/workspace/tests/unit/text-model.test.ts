import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { initDoc, createSticky, LOCAL_ORIGIN } from '../../src/shared/board-model';
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
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';

/**
 * Story 9 text.model — schema rules against a real Y.Doc.
 * TC-01 to TC-06 plus stale-id handling for every setter.
 */

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

/** Watch for any document update (a rejected call must not produce one). */
function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => {
    count += 1;
  });
  return () => count;
}

describe('text model (TC-01 to TC-06)', () => {
  it('TC-01: createText at (100, 50) → type text, size M, auto width, empty Y.Text, z on top, createdBy set', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 10, y: 10 });
    const stickyZ = objectMap(doc).get(stickyId)!.get('z') as number;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTypeOf('string');
    const map = objectMap(doc).get(id!);
    expect(map).toBeDefined();
    expect(map!.get('type')).toBe('text');
    expect(map!.get('x')).toBe(100);
    expect(map!.get('y')).toBe(50);
    expect(map!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(map!.get('size')).toBe('M');
    expect(map!.get('widthMode')).toBe('auto');
    expect(map!.get('createdBy')).toBe('g_test');
    expect((map!.get('z') as number)).toBeGreaterThan(stickyZ);
    const text = map!.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    // A stored box exists before the first measurement so selection bounds work.
    expect(map!.get('width')).toBeTypeOf('number');
    expect(map!.get('height')).toBeTypeOf('number');
    expect(Number.isFinite(map!.get('width'))).toBe(true);
    expect(Number.isFinite(map!.get('height'))).toBe(true);
    // createText writes with LOCAL_ORIGIN
    const created = new Y.Doc();
    initDoc(created);
    let origin: unknown = null;
    created.on('update', (_update, txnOrigin) => {
      origin = txnOrigin;
    });
    createText(created, { x: 0, y: 0 }, 'g_test');
    expect(origin).toBe(LOCAL_ORIGIN);
  });

  it('TC-02: setTextSize applies known presets; an unknown size is rejected with no update', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(objectMap(doc).get(id)!.get('size')).toBe('XL');

    const before = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(before()).toBe(0);
    expect(objectMap(doc).get(id)!.get('size')).toBe('XL');
  });

  it('TC-03: setTextWidthFixed clamps below to TEXT_MIN_WIDTH_WORLD and switches to fixed mode', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(objectMap(doc).get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(objectMap(doc).get(id)!.get('widthMode')).toBe('fixed');

    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(objectMap(doc).get(id)!.get('width')).toBe(120);
    expect(objectMap(doc).get(id)!.get('widthMode')).toBe('fixed');

    // Non-finite width → false, no transaction.
    const before = countUpdates(doc);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
    expect(before()).toBe(0);
  });

  it('TC-04: isEmptyText is zero characters only; deleteIfEmpty removes it, whitespace is kept', () => {
    const doc = freshDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectMap(doc).has(empty)).toBe(false);

    const blank = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, blank)!;
    doc.transact(() => {
      ytext.insert(0, '  ');
    }, LOCAL_ORIGIN);
    expect(isEmptyText(doc, blank)).toBe(false);
    expect(deleteIfEmpty(doc, blank)).toBe(false);
    expect(objectMap(doc).has(blank)).toBe(true);
  });

  it('TC-05: clampToLimit boundaries for TEXT_MAX_CHARS', () => {
    const over = 'a'.repeat(5001);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(5000);
    const accepted = 'a'.repeat(4999) + '!';
    expect(clampToLimit(accepted, TEXT_MAX_CHARS)).toBe(accepted);
    expect(clampToLimit('short', TEXT_MAX_CHARS)).toBe('short');
    expect(clampToLimit('', TEXT_MAX_CHARS)).toBe('');
  });

  it('TC-06: a non-finite create point returns null with no transaction', () => {
    const doc = freshDoc();
    const before = countUpdates(doc);
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(before()).toBe(0);
    expect(objectMap(doc).size).toBe(0);
  });

  it('stale ids: every setter returns false with no update; readers return undefined/false', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const before = countUpdates(doc);

    expect(setTextSize(doc, 'gone', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 10, height: 10 })).toBe(false);
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    expect(getTextContent(doc, 'gone')).toBeUndefined();
    // A sticky is not a text object either.
    expect(getTextContent(doc, stickyId)).toBeUndefined();
    expect(setTextSize(doc, stickyId, 'L')).toBe(false);
    expect(setTextBox(doc, stickyId, { width: 10, height: 10 })).toBe(false);
    expect(before()).toBe(0);
  });

  it('setTextBox writes a finite box with LOCAL_ORIGIN; non-finite values are rejected', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 123, height: 45 })).toBe(true);
    expect(objectMap(doc).get(id)!.get('width')).toBe(123);
    expect(objectMap(doc).get(id)!.get('height')).toBe(45);

    const before = countUpdates(doc);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 45 })).toBe(false);
    expect(setTextBox(doc, id, { width: 123, height: Number.NaN })).toBe(false);
    expect(before()).toBe(0);
  });

  it('editing text through getTextContent keeps every character (Y.Text storage)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => ytext.insert(0, 'Went'), LOCAL_ORIGIN);
    doc.transact(() => ytext.insert(4, ' well'), LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Went well');
    expect(isEmptyText(doc, id)).toBe(false);
  });
});
