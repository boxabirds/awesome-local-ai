/**
 * Task 1: Write text model unit tests first (TC-01 to TC-06)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
} from '@/shared/objects/text';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import {
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
} from '@/shared/config';

// Helper that creates a text object, asserting it returns a string id
function makeId(doc: Y.Doc, x: number, y: number, createdBy: string = 'u1'): string {
  const result = createText(doc, { x, y }, createdBy);
  expect(result).toBeDefined();
  return result!;
}

describe('text.model unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // ---- TC-01: createText basic ----
  it('TC-01: createText({100,50},"g_test") → type=text,size M,widthMode auto,empty Y.Text,z=top,createdBy', () => {
    const objectsMap = doc.getMap('objects');
    // Add a sticky first so we know what "top" means
    const stickyInner = new Y.Map() as Y.Map<unknown>;
    stickyInner.set('type', 'sticky');
    stickyInner.set('z', 5);
    objectsMap.set('existing-sticky', stickyInner);

    const id = makeId(doc, 100, 50, 'g_test');

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    const inner = objectsMap.get(id) as Y.Map<unknown>;
    expect(inner).toBeDefined();

    expect(inner.get('type')).toBe('text');
    expect(inner.get('x')).toBe(100);
    expect(inner.get('y')).toBe(50);
    expect(inner.get('size') ?? '').toBe(DEFAULT_TEXT_SIZE);
    expect(inner.get('widthMode')).toBe('auto');

    const textVal = inner.get('text');
    expect(textVal instanceof Y.Text).toBe(true);
    expect((textVal as Y.Text).toString()).toBe('');

    expect(inner.get('createdBy')).toBe('g_test');
    // z should be above existing sticky's z=5
    const expectedZ = 6;
    expect(inner.get('z')).toBe(expectedZ);
  });

  // ---- TC-02: setTextSize XL applied; 'XXL' → false ----
  it("TC-02: setTextSize applies XL correctly", () => {
    const objectsMap = doc.getMap('objects');
    const id = makeId(doc, 10, 10);
    const inner = objectsMap.get(id) as Y.Map<unknown>;

    const result = setTextSize(doc, id, 'XL');
    expect(result).toBe(true);
    expect(inner.get('size')).toBe('XL');
  });

  it("TC-02b: setTextSize with unknown key returns false and no update", () => {
    const objectsMap = doc.getMap('objects');
    const id = makeId(doc, 10, 10);
    const inner = objectsMap.get(id) as Y.Map<unknown>;
    const oldSize = inner.get('size');

    const result = setTextSize(doc, id, 'XXL');
    expect(result).toBe(false);
    expect(inner.get('size')).toBe(oldSize);
  });

  it('TC-02c: setTextSize on stale id returns false', () => {
    const result = setTextSize(doc, 'nonexistent-id', 'L');
    expect(result).toBe(false);
  });

  // ---- TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD ----
  it('TC-03: setTextWidthFixed(30) → width = TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const objectsMap = doc.getMap('objects');
    const id = makeId(doc, 10, 10);
    const inner = objectsMap.get(id) as Y.Map<unknown>;

    const result = setTextWidthFixed(doc, id, 30);
    expect(result).toBe(true);
    expect(inner.get('widthMode')).toBe('fixed');
    expect(inner.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-03b: setTextWidthFixed on stale id returns false', () => {
    const result = setTextWidthFixed(doc, 'nonexistent-id', 100);
    expect(result).toBe(false);
  });

  // ---- TC-04: isEmptyText & deleteIfEmpty ----
  it('TC-04a: isEmptyText true for zero characters', () => {
    const id = makeId(doc, 10, 10);
    expect(isEmptyText(doc, id)).toBe(true);
  });

  it('TC-04b: isEmptyText false for whitespace-only text', () => {
    const id = makeId(doc, 10, 10);
    const textVal = getTextContent(doc, id)!;
    doc.transact(() => {
      textVal.insert(0, '  ');
    }, LOCAL_ORIGIN);
    expect(isEmptyText(doc, id)).toBe(false);
  });

  it('TC-04c: deleteIfEmpty removes object when empty; keeps when not empty', () => {
    const objectsMap = doc.getMap('objects') as Y.Map<any>;
    const id = makeId(doc, 10, 10);
    expect(objectsMap.has(id)).toBe(true);

    const removed = deleteIfEmpty(doc, id);
    expect(removed).toBe(true);
    expect(objectsMap.has(id)).toBe(false);
  });

  it('TC-04d: deleteIfEmpty returns false when not empty', () => {
    const id = makeId(doc, 10, 10);
    const textVal = getTextContent(doc, id)!;
    doc.transact(() => {
      textVal.insert(0, 'a');
    }, LOCAL_ORIGIN);
    const removed = deleteIfEmpty(doc, id);
    expect(removed).toBe(false);
  });

  // ---- TC-05: clampToLimit boundaries ----
  it('TC-05a: clamp 5001 chars → 5000', async () => {
    const { clampToLimit } = await import('@/shared/text-edit');
    const long = 'a'.repeat(5001);
    const result = clampToLimit(long, TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
  });

  it('TC-05b: 4999 + 1 accepted', async () => {
    const { clampToLimit } = await import('@/shared/text-edit');
    const near = 'a'.repeat(5000);
    const result = clampToLimit(near, TEXT_MAX_CHARS);
    expect(result.length).toBe(5000);
  });

  // ---- TC-06: non-finite create point → null ----
  it('TC-06: non-finite create point → null, no transaction', () => {
    const result = createText(doc, { x: NaN, y: 50 }, 'u1');
    expect(result).toBeNull();

    const result2 = createText(doc, { x: 100, y: Infinity }, 'u1');
    expect(result2).toBeNull();

    const result3 = createText(doc, { x: -Infinity, y: 100 }, 'u1');
    expect(result3).toBeNull();
  });

  // ---- Additional: setTextBox ----
  it('setTextBox: sets width/height on valid id', () => {
    const objectsMap = doc.getMap('objects');
    const id = makeId(doc, 10, 10);
    const inner = objectsMap.get(id) as Y.Map<unknown>;

    const result = setTextBox(doc, id, { width: 200, height: 80 });
    expect(result).toBe(true);
    expect(inner.get('width')).toBe(200);
    expect(inner.get('height')).toBe(80);
  });

  it('setTextBox: stale id → false', () => {
    const result = setTextBox(doc, 'nonexistent-id', { width: 100, height: 50 });
    expect(result).toBe(false);
  });

  it('getTextContent: returns Y.Text for valid id', () => {
    const id = makeId(doc, 10, 10);
    const textVal = getTextContent(doc, id);
    expect(textVal).toBeDefined();
    expect(textVal instanceof Y.Text).toBe(true);
  });

  it('getTextContent: undefined for stale id', () => {
    const textVal = getTextContent(doc, 'nonexistent-id');
    expect(textVal).toBeUndefined();
  });
});
