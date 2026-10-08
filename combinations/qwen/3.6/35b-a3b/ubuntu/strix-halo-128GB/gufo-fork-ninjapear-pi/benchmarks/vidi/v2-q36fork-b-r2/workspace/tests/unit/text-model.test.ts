import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';
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

describe('TC-01: createText on empty doc', () => {
  it('creates a text object with type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    // Create a sticky first so we can check z ordering
    createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const objects = doc.getMap('objects');
    const textMap = objects.get(id!) as Y.Map<any>;
    expect(textMap.get('type')).toBe('text');
    expect(textMap.get('x')).toBe(100);
    expect(textMap.get('y')).toBe(50);
    expect(textMap.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(textMap.get('widthMode')).toBe('auto');
    expect(textMap.get('text') instanceof Y.Text).toBe(true);
    expect((textMap.get('text') as Y.Text).length).toBe(0);
    expect(textMap.get('createdBy')).toBe('g_test');
    expect(textMap.get('z')).toBe(2); // above sticky's z=1
  });
});

describe('TC-02: setTextSize XL applied; XXL -> false (error path)', () => {
  it('sets size to XL successfully', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    let updates = 0;
    doc.on('update', () => { updates++; });

    const ok = setTextSize(doc, id!, 'XL');
    expect(ok).toBe(true);
    expect(updates).toBe(1);

    const objects = doc.getMap('objects');
    const textMap = objects.get(id!) as Y.Map<any>;
    expect(textMap.get('size')).toBe('XL');
  });

  it('rejects unknown size key, no update event', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    let updates = 0;
    doc.on('update', () => { updates++; });

    const ok = setTextSize(doc, id!, 'XXL');
    expect(ok).toBe(false);
    expect(updates).toBe(0);

    const objects = doc.getMap('objects');
    const textMap = objects.get(id!) as Y.Map<any>;
    expect(textMap.get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('stale id returns false', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ok = setTextSize(doc, 'nonexistent-id', 'M');
    expect(ok).toBe(false);
  });
});

describe('TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD', () => {
  it('width 30 -> clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    let updates = 0;
    doc.on('update', () => { updates++; });

    const ok = setTextWidthFixed(doc, id!, 30);
    expect(ok).toBe(true);
    expect(updates).toBe(1);

    const objects = doc.getMap('objects');
    const textMap = objects.get(id!) as Y.Map<any>;
    expect(textMap.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(textMap.get('widthMode')).toBe('fixed');
  });

  it('width above min accepted', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');

    const ok = setTextWidthFixed(doc, id!, 100);
    expect(ok).toBe(true);

    const objects = doc.getMap('objects');
    const textMap = objects.get(id!) as Y.Map<any>;
    expect(textMap.get('width')).toBe(100);
    expect(textMap.get('widthMode')).toBe('fixed');
  });
});

describe('TC-04: isEmptyText and deleteIfEmpty', () => {
  it('isEmptyText true for zero characters', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    expect(isEmptyText(doc, id!)).toBe(true);
  });

  it('isEmptyText false when text has content', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    const ytext = getTextContent(doc, id!);
    if (!ytext) throw new Error('Y.Text not found');
    doc.transact(() => { ytext.insert(0, 'hello'); }, null);
    expect(isEmptyText(doc, id!)).toBe(false);
  });

  it('deleteIfEmpty removes when empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    const result = deleteIfEmpty(doc, id!);
    expect(result).toBe(true);

    const objects = doc.getMap('objects');
    expect(objects.has(id!)).toBe(false);
  });

  it('deleteIfEmpty returns false when not empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    const ytext = getTextContent(doc, id!);
    if (!ytext) throw new Error('Y.Text not found');
    doc.transact(() => { ytext.insert(0, 'x'); }, null);

    const result = deleteIfEmpty(doc, id!);
    expect(result).toBe(false);

    const objects = doc.getMap('objects');
    expect(objects.has(id!)).toBe(true);
  });
});

describe('TC-05: clampToLimit boundaries', () => {
  it('5,001 chars -> 5,000', () => {
    const long = 'a'.repeat(5001);
    const result = clampToLimit(long, TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
  });

  it('4,999 + 1 accepted -> 5,000', () => {
    const near = 'x'.repeat(4999);
    const result = clampToLimit(near + ' ', TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
  });

  it('4,999 chars passed unchanged', () => {
    const short = 'x'.repeat(4999);
    const result = clampToLimit(short, TEXT_MAX_CHARS);
    expect(result).toBe(short);
  });
});

describe('TC-06: non-finite create point -> null', () => {
  it('NaN x coordinate -> null', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = createText(doc, { x: NaN, y: 0 }, 'test');
    expect(result).toBeNull();
  });

  it('Infinity x coordinate -> null', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = createText(doc, { x: Infinity, y: 0 }, 'test');
    expect(result).toBeNull();
  });

  it('finite coordinates succeed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = createText(doc, { x: -100, y: 50.5 }, 'test');
    expect(result).toBeTruthy();
  });
});

describe('setTextBox', () => {
  it('updates width and height', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');
    let updates = 0;
    doc.on('update', () => { updates++; });

    const ok = setTextBox(doc, id!, { width: 150, height: 40 });
    expect(ok).toBe(true);
    expect(updates).toBe(1);

    const objects = doc.getMap('objects');
    const textMap = objects.get(id!) as Y.Map<any>;
    expect(textMap.get('width')).toBe(150);
    expect(textMap.get('height')).toBe(40);
  });

  it('returns false when box is unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'test');

    // First call writes the default box
    setTextBox(doc, id!, { width: 600, height: 26 });

    // Second call with same values should return false
    let updates = 0;
    doc.on('update', () => { updates++; });
    const ok = setTextBox(doc, id!, { width: 600, height: 26 });
    expect(ok).toBe(false);
    expect(updates).toBe(0);
  });
});
