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
  allTextSnapshots,
  getDocObjects,
} from '@shared/objects/text';
import { DEFAULT_TEXT_SIZE, TEXT_MIN_WIDTH_WORLD, TEXT_MAX_CHARS } from '@shared/config';
import { initDoc, createSticky } from '@shared/board-model';
import { clampToLimit } from '@shared/text-edit';

describe('TC-01: createText', () => {
  it('creates a text object with correct properties', () => {
    const doc = new Y.Doc();
    // Add a sticky first so we can verify z ordering
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const objects = getDocObjects(doc);
    const dm = objects.get(id) as any;

    expect(dm).toBeDefined();
    expect(String(dm.get('type'))).toBe('text');
    expect(Number(dm.get('x'))).toBe(100);
    expect(Number(dm.get('y'))).toBe(50);
    expect(dm.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(dm.get('widthMode')).toBe('auto');
    expect(dm.get('text')).toBeInstanceOf(Y.Text);
    expect(dm.get('text').toString()).toBe('');
    expect(dm.get('createdBy')).toBe('g_test');
    // z should be above sticky's z
    const stickyDm = [...objects.values()][0] as any;
    expect(Number(dm.get('z'))).toBeGreaterThan(Number(stickyDm.get('z')));
  });

  it('initial box has estimate width and height', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const objects = getDocObjects(doc);
    const dm = objects.get(id) as any;
    expect(dm.get('width')).toBe(90);
    expect(dm.get('height')).toBe(20 * 1.3);
  });
});

describe('TC-02: setTextSize', () => {
  it('applies XL size', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const result = setTextSize(doc, id, 'XL');
    expect(result).toBe(true);
    const objects = getDocObjects(doc);
    const dm = objects.get(id) as any;
    expect(dm.get('size')).toBe('XL');
  });

  it('rejects unknown size key', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const result = setTextSize(doc, id, 'XXL');
    expect(result).toBe(false);
    const objects = getDocObjects(doc);
    const dm = objects.get(id) as any;
    expect(dm.get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('rejects stale id', () => {
    const doc = new Y.Doc();
    const result = setTextSize(doc, 'nonexistent', 'M');
    expect(result).toBe(false);
  });
});

describe('TC-03: setTextWidthFixed', () => {
  it('clamps width below minimum to TEXT_MIN_WIDTH_WORLD', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const result = setTextWidthFixed(doc, id, 30);
    expect(result).toBe(true);
    const objects = getDocObjects(doc);
    const dm = objects.get(id) as any;
    expect(Number(dm.get('width'))).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(dm.get('widthMode')).toBe('fixed');
  });

  it('accepts valid fixed width', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const result = setTextWidthFixed(doc, id, 200);
    expect(result).toBe(true);
    const objects = getDocObjects(doc);
    const dm = objects.get(id) as any;
    expect(Number(dm.get('width'))).toBe(200);
    expect(dm.get('widthMode')).toBe('fixed');
  });

  it('rejects non-finite width', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const result = setTextWidthFixed(doc, id, NaN);
    expect(result).toBe(false);
  });
});

describe('TC-04: isEmptyText and deleteIfEmpty', () => {
  it('isEmptyText returns true for zero characters', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    expect(isEmptyText(doc, id)).toBe(true);
  });

  it('deleteIfEmpty removes empty text', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const result = deleteIfEmpty(doc, id);
    expect(result).toBe(true);
    const objects = getDocObjects(doc);
    expect(objects.has(id)).toBe(false);
  });

  it('whitespace-only text is kept (not empty)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'test')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, '  ');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
  });
});

describe('TC-05: clampToLimit', () => {
  it('5001 chars → clamped to 5000', () => {
    const long = 'a'.repeat(5001);
    const clipped = clampToLimit(long, TEXT_MAX_CHARS);
    expect(clipped.length).toBe(5000);
  });

  it('4999 + 1 accepted (boundary)', () => {
    const text = 'a'.repeat(4999);
    const result = clampToLimit(text + 'b', TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
  });
});

describe('TC-06: createText with non-finite point', () => {
  it('NaN coordinates → null, no transaction created', () => {
    const doc = new Y.Doc();
    const result = createText(doc, { x: NaN, y: 0 }, 'test');
    expect(result).toBeNull();
    const objects = getDocObjects(doc);
    const textObjs = [...objects.entries()].filter(([, v]) => {
      if (!(v instanceof Y.Map)) return false;
      return String((v as any).get('type') ?? '') === 'text';
    });
    expect(textObjs.length).toBe(0);
  });

  it('Infinity coordinates → null', () => {
    const doc = new Y.Doc();
    const result = createText(doc, { x: Infinity, y: 0 }, 'test');
    expect(result).toBeNull();
  });
});

describe('TC-stale: stale id for setters', () => {
  it('setTextBox rejects stale id', () => {
    const doc = new Y.Doc();
    const result = setTextBox(doc, 'nonexistent', { width: 100, height: 20 });
    expect(result).toBe(false);
  });

  it('getTextContent returns undefined for stale id', () => {
    const doc = new Y.Doc();
    const result = getTextContent(doc, 'nonexistent');
    expect(result).toBeUndefined();
  });
});
