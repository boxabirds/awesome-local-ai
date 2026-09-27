// Story 9, text.model: the schema and every mutation of a free-text block,
// tested against a real Y.Doc (no DOM, no React).
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
  getTextObject,
} from '../../src/shared/objects/text';
import { initDoc, createSticky, snapshot, objectSnapshots, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import { clampToLimit, applyTextDiff } from '../../src/shared/text-edit';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
});

/** Count document updates produced by `fn` (an unwanted write is a write). */
function updatesDuring(fn: () => void): number {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  fn();
  doc.off('update', observer);
  return updates;
}

function raw(id: string): Y.Map<unknown> {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

describe('createText (text.model)', () => {
  it('TC-01: creates a size-M auto-width block on top, authored by the caller', () => {
    const note = createSticky(doc, { x: 0, y: 0 });
    const noteZ = raw(note).get('z') as number;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).toBeTruthy();

    const obj = raw(id);
    expect(obj.get('type')).toBe('text');
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('size')).toBe('M');
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('createdBy')).toBe('g_test');
    // The text exists and is empty.
    const text = obj.get('text') as Y.Text;
    expect(text).toBeInstanceOf(Y.Text);
    expect(text.toString()).toBe('');
    // A footprint exists immediately, so bounds/marquee work before the first
    // measurement.
    expect(obj.get('width')).toBeGreaterThan(0);
    expect(obj.get('height')).toBeCloseTo(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    // Stacked above everything already on the board.
    expect(obj.get('z' as never)).toBeGreaterThan(noteZ);

    // And it is projected as a text object, not as a note.
    const projected = objectSnapshots(doc).find((o) => o.id === id);
    expect(projected?.type).toBe('text');
    expect(snapshot(doc).some((o) => o.id === id)).toBe(false);
  });

  it('TC-06: a non-finite point creates nothing and opens no transaction', () => {
    expect(createText(doc, { x: Number.NaN, y: 10 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 10, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(doc.getMap<Y.Map<unknown>>('objects').size).toBe(0);
  });

  it('the creation transaction carries LOCAL_ORIGIN, so undo can take it back', () => {
    let origin: unknown = 'nothing';
    doc.on('afterTransaction', (tx: { origin: unknown }) => {
      origin = tx.origin;
    });
    createText(doc, { x: 10, y: 10 }, 'g_test');
    expect(origin).toBe(LOCAL_ORIGIN);
  });
});

describe('setTextSize', () => {
  it('TC-02: XL is applied; an unknown key is rejected without an update', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(raw(id).get('size')).toBe('XL');

    expect(updatesDuring(() => expect(setTextSize(doc, id, 'XXL')).toBe(false))).toBe(0);
    expect(raw(id).get('size')).toBe('XL');
    // The same size again is also a no-op.
    expect(setTextSize(doc, id, 'XL')).toBe(false);
  });

  it('a stale id is rejected without an update', () => {
    expect(updatesDuring(() => expect(setTextSize(doc, 'gone', 'L')).toBe(false))).toBe(0);
  });
});

describe('setTextWidthFixed', () => {
  it('TC-03: 30 clamps up to TEXT_MIN_WIDTH_WORLD and pins the mode to fixed', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(raw(id).get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(raw(id).get('widthMode')).toBe('fixed');
  });

  it('a wider width is stored as given; a non-finite one is rejected', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 321.5)).toBe(true);
    expect(raw(id).get('width')).toBe(321.5);
    expect(updatesDuring(() => expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false))).toBe(0);
    expect(updatesDuring(() => expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false))).toBe(0);
  });
});

describe('setTextBox', () => {
  it('writes a new footprint, skips an identical one, and rejects junk', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);
    expect(getTextObject(doc, id)).toMatchObject({ width: 120, height: 52 });
    expect(updatesDuring(() => expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(false))).toBe(0);
    expect(setTextBox(doc, id, { width: 0, height: 52 })).toBe(false);
    expect(setTextBox(doc, id, { width: -5, height: 52 })).toBe(false);
    expect(setTextBox(doc, id, { width: 100, height: Number.NaN })).toBe(false);
    expect(updatesDuring(() => expect(setTextBox(doc, 'gone', { width: 10, height: 10 })).toBe(false))).toBe(0);
  });
});

describe('empty text (text.model)', () => {
  it('TC-04: zero characters are empty and are removed; whitespace is kept', () => {
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(empty)).toBe(false);

    const blank = createText(doc, { x: 10, y: 10 }, 'g_test')!;
    applyTextDiff(getTextContent(doc, blank)!, '  ', LOCAL_ORIGIN);
    expect(isEmptyText(doc, blank)).toBe(false);
    expect(deleteIfEmpty(doc, blank)).toBe(false);
    expect(doc.getMap<Y.Map<unknown>>('objects').has(blank)).toBe(true);
  });

  it('a stale id is neither empty nor deletable', () => {
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
  });
});

describe('clampToLimit with the text limit (text.model)', () => {
  it('TC-05: 5,001 → 5,000 and 4,999 + 1 → 5,000 (boundaries)', () => {
    const long = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);

    const current = 'a'.repeat(TEXT_MAX_CHARS - 1);
    const accepted = clampToLimit(current + 'b', TEXT_MAX_CHARS);
    expect(accepted.length).toBe(TEXT_MAX_CHARS);
    expect(accepted).toBe(current + 'b');

    // One over the limit after that is refused.
    expect(clampToLimit(accepted + 'b', TEXT_MAX_CHARS)).toBe(accepted);
  });
});
