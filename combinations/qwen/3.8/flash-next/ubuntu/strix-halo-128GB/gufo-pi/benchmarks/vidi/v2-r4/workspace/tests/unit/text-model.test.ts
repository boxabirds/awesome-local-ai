import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN, createSticky } from '../../src/shared/board-model';
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
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('text.model — createText', () => {
  it('TC-01 creates a text object with type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    const doc = makeDoc();
    // Create a sticky first to ensure z is above it
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    expect(stickyId).toBeTruthy();

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('text');
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
    expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj!.get('widthMode')).toBe('auto');
    expect(obj!.get('createdBy')).toBe('g_test');
    const text = obj!.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    // z above existing objects
    const stickyObj = objects.get(stickyId);
    expect((obj!.get('z') as number)).toBeGreaterThan(stickyObj!.get('z') as number);
  });

  it('TC-06 returns null for non-finite point, no transaction', () => {
    const doc = makeDoc();
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    const result = createText(doc, { x: NaN, y: 50 }, 'g_test');
    expect(result).toBeNull();

    const result2 = createText(doc, { x: 100, y: Infinity }, 'g_test');
    expect(result2).toBeNull();

    // No new objects in doc
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);
  });
});

describe('text.model — setTextSize', () => {
  it('TC-02 applies a valid size key', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const result = setTextSize(doc, id, 'XL');
    expect(result).toBe(true);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(id)!.get('size')).toBe('XL');
  });

  it('TC-02 rejects an unknown size key with false, no update event', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });
    const result = setTextSize(doc, id, 'XXL');
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
    // Size unchanged
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(id)!.get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('stale id returns false', () => {
    const doc = makeDoc();
    expect(setTextSize(doc, 'nonexistent', 'L')).toBe(false);
  });
});

describe('text.model — setTextWidthFixed', () => {
  it('TC-03 clamps below TEXT_MIN_WIDTH_WORLD and sets widthMode to fixed', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const result = setTextWidthFixed(doc, id, 30);
    expect(result).toBe(true);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(objects.get(id)!.get('widthMode')).toBe('fixed');
  });

  it('TC-03 accepts width at exactly TEXT_MIN_WIDTH_WORLD', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('stale id returns false', () => {
    const doc = makeDoc();
    expect(setTextWidthFixed(doc, 'nonexistent', 100)).toBe(false);
  });

  it('non-finite width returns false', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
  });
});

describe('text.model — setTextBox', () => {
  it('updates width and height', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 200, height: 100 })).toBe(true);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.get(id)!.get('width')).toBe(200);
    expect(objects.get(id)!.get('height')).toBe(100);
  });

  it('stale id returns false', () => {
    const doc = makeDoc();
    expect(setTextBox(doc, 'nonexistent', { width: 100, height: 50 })).toBe(false);
  });

  it('non-finite box returns false', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: Infinity, height: 50 })).toBe(false);
  });
});

describe('text.model — isEmptyText and deleteIfEmpty', () => {
  it('TC-04 isEmptyText is true for zero characters', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
  });

  it('TC-04 whitespace-only text is NOT considered empty', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, '  '); }, LOCAL_ORIGIN);
    expect(isEmptyText(doc, id)).toBe(false);
  });

  it('TC-04 deleteIfEmpty removes an empty text object', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(deleteIfEmpty(doc, id)).toBe(true);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.has(id)).toBe(false);
  });

  it('TC-04 deleteIfEmpty does not remove a non-empty text object', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => { ytext.insert(0, 'a'); }, LOCAL_ORIGIN);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.has(id)).toBe(true);
  });

  it('stale id returns false for isEmptyText', () => {
    const doc = makeDoc();
    expect(isEmptyText(doc, 'nonexistent')).toBe(false);
  });

  it('stale id returns false for deleteIfEmpty', () => {
    const doc = makeDoc();
    expect(deleteIfEmpty(doc, 'nonexistent')).toBe(false);
  });
});

describe('text.model — getTextContent', () => {
  it('returns the Y.Text of a text object', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const ytext = getTextContent(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
  });

  it('returns undefined for a sticky note', () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(getTextContent(doc, id)).toBeUndefined();
  });

  it('returns undefined for a stale id', () => {
    const doc = makeDoc();
    expect(getTextContent(doc, 'nonexistent')).toBeUndefined();
  });
});

describe('text-edit — clampToLimit', () => {
  it('TC-05 5,001 characters are clamped to 5,000', () => {
    const input = 'a'.repeat(5001);
    const result = clampToLimit(input, TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
  });

  it('TC-05 4,999 + 1 = 5,000 characters accepted (boundary)', () => {
    const input = 'a'.repeat(4999) + '!';
    const result = clampToLimit(input, TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
    expect(result).toBe(input);
  });

  it('does not split a surrogate pair at the limit', () => {
    const text = 'a'.repeat(4999) + '\u{1F600}';
    const result = clampToLimit(text, TEXT_MAX_CHARS);
    expect(result).toBe('a'.repeat(4999));
  });
});
