/**
 * Unit tests for the text object model (text.model contract).
 * TC-01 to TC-06, against a real Y.Doc.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, objects, LOCAL_ORIGIN } from '../../src/shared/board-model';
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
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count doc updates fired between the start and end of a mutation. */
function withUpdateCount(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return updates;
}

describe('text.model', () => {
  // TC-01: createText → type text, size M, widthMode auto, empty Y.Text,
  // z above existing objects, createdBy set.
  it('TC-01: createText places a size-M auto-width text above all objects', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).not.toBeNull();

    const all = objects(doc);
    const text = all.find((o) => o.id === id)!;
    const sticky = all.find((o) => o.id === stickyId)!;
    expect(text.type).toBe('text');
    expect(text.x).toBe(100);
    expect(text.y).toBe(50);
    expect(text.z).toBeGreaterThan(sticky.z);

    const objMap = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(objMap.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(objMap.get('size')).toBe('M');
    expect(objMap.get('widthMode')).toBe('auto');
    expect(objMap.get('createdBy')).toBe('g_test');
    const ytext = objMap.get('text') as Y.Text;
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext.toString()).toBe('');
  });

  // TC-02: setTextSize XL applied; 'XXL' → false, no update (error path).
  it('TC-02: setTextSize applies known sizes and rejects unknown ones', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const objMap = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(objMap.get('size')).toBe('XL');
    expect(TEXT_SIZES.XL).toBe(56);

    const updates = withUpdateCount(doc, () => {
      expect(setTextSize(doc, id, 'XXL')).toBe(false);
    });
    expect(updates).toBe(0);
    expect(objMap.get('size')).toBe('XL');
  });

  // TC-03: setTextWidthFixed(id, 30) → clamped to TEXT_MIN_WIDTH_WORLD,
  // widthMode fixed (boundary).
  it('TC-03: setTextWidthFixed clamps to the minimum and sets fixed mode', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 10, y: 20 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const objMap = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(objMap.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(objMap.get('widthMode')).toBe('fixed');

    // A width above the minimum is applied as-is.
    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(objMap.get('width')).toBe(120);
  });

  // TC-04: isEmptyText true for zero characters → deleteIfEmpty removes;
  // whitespace-only text is kept (negative).
  it('TC-04: deleteIfEmpty removes only zero-character text', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);

    // Whitespace-only is NOT empty (only zero characters counts).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id2)!.insert(0, '  ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').has(id2)).toBe(true);
  });

  // TC-05: clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1
  // accepted (boundaries).
  it('TC-05: clampToLimit enforces TEXT_MAX_CHARS at the boundaries', () => {
    const over = 'A'.repeat(TEXT_MAX_CHARS + 1);
    expect(over.length).toBe(5001);
    const clamped = clampToLimit(over, TEXT_MAX_CHARS);
    expect(clamped.length).toBe(TEXT_MAX_CHARS);
    expect(clamped).toBe('A'.repeat(TEXT_MAX_CHARS));

    const atLimit = 'B'.repeat(TEXT_MAX_CHARS - 1) + 'C';
    expect(atLimit.length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
  });

  // TC-06: non-finite create point → null, no transaction (error path).
  it('TC-06: createText rejects non-finite points without a transaction', () => {
    const doc = makeDoc();
    const updates = withUpdateCount(doc, () => {
      expect(createText(doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
      expect(createText(doc, { x: 100, y: Infinity }, 'g_test')).toBeNull();
    });
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  // Stale id for every setter → false, no update.
  it('stale ids: every setter returns false without a transaction', () => {
    const doc = makeDoc();
    const updates = withUpdateCount(doc, () => {
      expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
      expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
      expect(setTextBox(doc, 'missing', { width: 10, height: 10 })).toBe(false);
      expect(getTextContent(doc, 'missing')).toBeUndefined();
      expect(isEmptyText(doc, 'missing')).toBe(false);
      expect(deleteIfEmpty(doc, 'missing')).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // setTextBox writes width/height for a live object.
  it('setTextBox stores the measured box', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextBox(doc, id, { width: 123.5, height: 52 })).toBe(true);
    const objMap = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(objMap.get('width')).toBe(123.5);
    expect(objMap.get('height')).toBe(52);

    // Non-finite or non-positive boxes are rejected.
    const updates = withUpdateCount(doc, () => {
      expect(setTextBox(doc, id, { width: NaN, height: 52 })).toBe(false);
      expect(setTextBox(doc, id, { width: 10, height: 0 })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  // LOCAL_ORIGIN transactions: createText and setters use the local origin
  // so per-user undo captures them (story 8).
  it('mutations use LOCAL_ORIGIN so undo tracks them', () => {
    const doc = makeDoc();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    setTextSize(doc, id, 'L');
    expect(origins).toHaveLength(2);
    for (const o of origins) expect(o).toBe(LOCAL_ORIGIN);
  });
});
