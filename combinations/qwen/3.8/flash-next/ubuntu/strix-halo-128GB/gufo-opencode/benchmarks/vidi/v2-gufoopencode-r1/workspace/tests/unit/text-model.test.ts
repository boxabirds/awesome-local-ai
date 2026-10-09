import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';

function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function entry(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

describe('text.model', () => {
  test('TC-01 createText yields a text object top-left at the point, size M, auto width, z top, createdBy set', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    const stop = countUpdates(doc);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(stop()).toBe(1);
    expect(typeof id).toBe('string');
    const created = entry(doc, id as string);
    expect(created.get('type')).toBe('text');
    expect(created.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(created.get('size')).toBe('M');
    expect(created.get('widthMode')).toBe('auto');
    expect(created.get('x')).toBe(100);
    expect(created.get('y')).toBe(50);
    expect(created.get('z')).toBe(2);
    expect(created.get('createdBy')).toBe('g_test');
    const width = created.get('width');
    const height = created.get('height');
    expect(typeof width).toBe('number');
    expect(typeof height).toBe('number');
    expect(width as number).toBeGreaterThan(0);
    expect(height as number).toBeGreaterThan(0);
    const text = getTextContent(doc, id as string);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
  });

  test('TC-02 setTextSize applies known keys and rejects unknown keys without an update', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const stop = countUpdates(doc);
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(stop()).toBe(1);
    expect(entry(doc, id).get('size')).toBe('XL');
    const stop2 = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, '')).toBe(false);
    expect(setTextSize(doc, id, '12')).toBe(false);
    expect(setTextSize(doc, id, 'xl')).toBe(false);
    expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
    expect(stop2()).toBe(0);
    expect(entry(doc, id).get('size')).toBe('XL');
  });

  test('TC-03 setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and switches to fixed mode', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const stop = countUpdates(doc);
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(stop()).toBe(1);
    const created = entry(doc, id);
    expect(created.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(created.get('widthMode')).toBe('fixed');
    expect(setTextWidthFixed(doc, id, 300)).toBe(true);
    expect(created.get('width')).toBe(300);
    expect(created.get('widthMode')).toBe('fixed');
    const stop2 = countUpdates(doc);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 300)).toBe(false);
    expect(stop2()).toBe(0);
    expect(created.get('width')).toBe(300);
  });

  test('TC-04 isEmptyText counts zero characters only and deleteIfEmpty removes them', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);

    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const text2 = getTextContent(doc, id2) as Y.Text;
    text2.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    const stop = countUpdates(doc);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(stop()).toBe(0);
    expect(doc.getMap('objects').has(id2)).toBe(true);

    const stop2 = countUpdates(doc);
    expect(isEmptyText(doc, 'missing')).toBe(false);
    expect(deleteIfEmpty(doc, 'missing')).toBe(false);
    expect(stop2()).toBe(0);
  });

  test('TC-05 clampToLimit enforces TEXT_MAX_CHARS boundaries', () => {
    const long = 'x'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    const atLimit = 'x'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
    const accepted = 'x'.repeat(TEXT_MAX_CHARS - 1) + 'y';
    expect(clampToLimit(accepted, TEXT_MAX_CHARS)).toBe(accepted);
    expect(TEXT_MAX_CHARS).toBe(5000);
  });

  test('TC-05b applyTextDiff writes minimal content with the given origin', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const ytext = getTextContent(doc, id) as Y.Text;
    const stop = countUpdates(doc);
    applyTextDiff(ytext, 'hello', LOCAL_ORIGIN);
    expect(stop()).toBe(1);
    expect(ytext.toString()).toBe('hello');
    applyTextDiff(ytext, 'hello', LOCAL_ORIGIN);
    expect(stop()).toBe(1);
  });

  test('TC-06 createText rejects non-finite points with null and no transaction', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    expect(createText(doc, { x: Number.NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 100, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(stop()).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  test('stale ids are rejected by every setter with no update', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 }) as string;
    const stop = countUpdates(doc);
    expect(setTextSize(doc, 'missing', 'M')).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 100, height: 50 })).toBe(false);
    expect(getTextContent(doc, 'missing')).toBeUndefined();
    // Wrong object type is stale for text setters too.
    expect(setTextSize(doc, stickyId, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, stickyId, 100)).toBe(false);
    expect(setTextBox(doc, stickyId, { width: 100, height: 50 })).toBe(false);
    expect(getTextContent(doc, stickyId)).toBeUndefined();
    expect(stop()).toBe(0);
  });

  test('setTextBox stores finite dimensions and rejects bad values', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const stop = countUpdates(doc);
    expect(setTextBox(doc, id, { width: 250, height: 78 })).toBe(true);
    expect(stop()).toBe(1);
    expect(entry(doc, id).get('width')).toBe(250);
    expect(entry(doc, id).get('height')).toBe(78);
    const stop2 = countUpdates(doc);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 78 })).toBe(false);
    expect(setTextBox(doc, id, { width: 250, height: Number.NaN })).toBe(false);
    expect(stop2()).toBe(0);
  });
});
