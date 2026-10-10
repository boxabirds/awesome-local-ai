import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

// Counts 'update' events from now on; used to assert "no transaction".
function trackUpdates(doc: Y.Doc): { count(): number; stop(): void } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  return {
    count: () => updates,
    stop: () => doc.off('update', listener)
  };
}

describe('text.model', () => {
  test('TC-01 createText places a text object at the point with the default schema', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = objectsOf(doc).get(sticky)!.get('z') as number;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const obj = objectsOf(doc).get(id!);
    expect(obj).toBeDefined();
    // Top-left is the given point (unlike createSticky, which centres).
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
    expect(obj!.get('type')).toBe('text');
    expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj!.get('widthMode')).toBe('auto');
    expect(obj!.get('createdBy')).toBe('g_test');
    expect(typeof obj!.get('createdAt')).toBe('number');
    expect(obj!.get('text')).toBeInstanceOf(Y.Text);
    expect((obj!.get('text') as Y.Text).toString()).toBe('');
    // z sits above every other object.
    expect(obj!.get('z')).toBeGreaterThan(stickyZ);
    // An initial positive estimated box lets selection work before first edit.
    expect(obj!.get('width')).toBeGreaterThan(0);
    expect(obj!.get('height')).toBeGreaterThan(0);
  });

  test('TC-02 setTextSize accepts presets and rejects unknown keys without a transaction', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(objectsOf(doc).get(id)!.get('size')).toBe('XL');

    const tracker = trackUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, DEFAULT_TEXT_SIZE)).toBe(true);
    expect(setTextSize(doc, id, DEFAULT_TEXT_SIZE)).toBe(false); // no-op re-set
    expect(setTextSize(doc, 'no-such-id', 'L')).toBe(false);
    expect(objectsOf(doc).get(id)!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    tracker.stop();
    // The rejected calls and the no-op re-set must not produce transactions.
    expect(tracker.count()).toBe(1);
  });

  test('TC-03 setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and switches to fixed mode', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(objectsOf(doc).get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(objectsOf(doc).get(id)!.get('widthMode')).toBe('fixed');

    // Exactly at the minimum still switches an auto text to fixed.
    const boundary = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, boundary, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(objectsOf(doc).get(boundary)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(objectsOf(doc).get(boundary)!.get('widthMode')).toBe('fixed');

    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(objectsOf(doc).get(id)!.get('width')).toBe(250);
    expect(objectsOf(doc).get(id)!.get('widthMode')).toBe('fixed');

    const tracker = trackUpdates(doc);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, 'no-such-id', 100)).toBe(false);
    tracker.stop();
    expect(tracker.count()).toBe(0);
    expect(objectsOf(doc).get(id)!.get('width')).toBe(250);
  });

  test('TC-04 isEmptyText and deleteIfEmpty: only zero characters counts as empty', () => {
    const doc = newDoc();

    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectsOf(doc).get(empty)).toBeUndefined();

    const whitespace = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, whitespace)!.insert(0, '  ');
    expect(isEmptyText(doc, whitespace)).toBe(false);
    expect(deleteIfEmpty(doc, whitespace)).toBe(false);
    expect(objectsOf(doc).get(whitespace)).toBeDefined();

    const typed = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, typed)!.insert(0, 'a');
    expect(isEmptyText(doc, typed)).toBe(false);
    expect(deleteIfEmpty(doc, typed)).toBe(false);
    expect(objectsOf(doc).get(typed)).toBeDefined();

    // Missing objects and stale ids are never empty and never deleted.
    expect(isEmptyText(doc, 'no-such-id')).toBe(false);
    expect(deleteIfEmpty(doc, 'no-such-id')).toBe(false);
    expect(getTextContent(doc, 'no-such-id')).toBeUndefined();
  });

  test('TC-05 clampToLimit accepts 4,999 + 1 and truncates 5,001 to 5,000', () => {
    expect(clampToLimit('x'.repeat(5001), TEXT_MAX_CHARS)).toBe('x'.repeat(5000));
    const boundary = clampToLimit('x'.repeat(4999) + '!', TEXT_MAX_CHARS);
    expect(boundary).toHaveLength(5000);
    expect(boundary.endsWith('!')).toBe(true);
  });

  test('TC-06 non-finite inputs produce null/false with no transaction', () => {
    const doc = newDoc();
    const tracker = trackUpdates(doc);

    expect(createText(doc, { x: Number.POSITIVE_INFINITY, y: 5 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 10, y: Number.NaN }, 'g_test')).toBeNull();
    expect(objectsOf(doc).size).toBe(0);

    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: Number.NaN, height: 20 })).toBe(false);
    expect(setTextBox(doc, id, { width: 100, height: Number.POSITIVE_INFINITY })).toBe(false);
    expect(setTextBox(doc, id, { width: -5, height: 20 })).toBe(false);
    expect(setTextBox(doc, 'no-such-id', { width: 100, height: 20 })).toBe(false);

    tracker.stop();
    expect(tracker.count()).toBe(1); // only the successful createText above
  });

  test('setTextBox writes a valid box once and rejects redundant or invalid values', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextBox(doc, id, { width: 300, height: 52 })).toBe(true);
    expect(objectsOf(doc).get(id)!.get('width')).toBe(300);
    expect(objectsOf(doc).get(id)!.get('height')).toBe(52);

    const tracker = trackUpdates(doc);
    expect(setTextBox(doc, id, { width: 300, height: 52 })).toBe(false);
    tracker.stop();
    expect(tracker.count()).toBe(0);
  });
});
