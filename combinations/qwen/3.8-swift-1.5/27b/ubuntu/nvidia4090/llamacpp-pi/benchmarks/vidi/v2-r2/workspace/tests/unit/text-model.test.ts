/**
 * Story 9: text.model unit tests (TC-01 to TC-06) against a real Y.Doc.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  objectSnapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
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
  TEXT_SIZES,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function textObj(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = doc.getMap('objects').get(id);
  if (!(obj instanceof Y.Map)) throw new Error(`object ${id} not found`);
  return obj;
}

describe('text.model (unit)', () => {
  it('TC-01: createText at (100,50) → type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    const doc = makeDoc();
    // An existing sticky at z=1.
    createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const obj = textObj(doc, id!);
    expect(obj.get('type')).toBe('text');
    // Top-left at the clicked point.
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(typeof obj.get('createdAt')).toBe('number');
    // z above every other object.
    expect(obj.get('z')).toBeGreaterThan(1);
    // Empty Y.Text.
    const text = obj.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    // A box exists so bounds are defined before the first measure.
    expect(typeof obj.get('width')).toBe('number');
    expect(typeof obj.get('height')).toBe('number');
  });

  it('TC-02: setTextSize XL applied; unknown key → false, no update', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textObj(doc, id).get('size')).toBe('XL');
    expect(TEXT_SIZES.XL).toBe(56);

    // Unknown size key → false, no update event.
    let updates = 0;
    const obj = textObj(doc, id);
    obj.observe(() => {
      updates++;
    });
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates).toBe(0);
    expect(obj.get('size')).toBe('XL');
  });

  it('TC-03: setTextWidthFixed(30) → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const obj = textObj(doc, id);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // A width above the minimum is kept as-is.
    expect(setTextWidthFixed(doc, id, 200)).toBe(true);
    expect(textObj(doc, id).get('width')).toBe(200);
  });

  it('TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    // Zero characters → empty.
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').get(id)).toBeUndefined();

    // Whitespace-only is NOT empty (only zero characters counts).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g')!;
    getTextContent(doc, id2)!.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').get(id2)).toBeDefined();
  });

  it(`TC-05: clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted`, () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1);
    const clamped = clampToLimit(over, TEXT_MAX_CHARS);
    expect(clamped.length).toBe(TEXT_MAX_CHARS);
    expect(clamped).toBe(over.slice(0, TEXT_MAX_CHARS));

    const atLimitMinus1 = 'b'.repeat(TEXT_MAX_CHARS - 1);
    const accepted = clampToLimit(atLimitMinus1 + 'c', TEXT_MAX_CHARS);
    expect(accepted.length).toBe(TEXT_MAX_CHARS);
    expect(accepted).toBe(atLimitMinus1 + 'c');

    // Under the limit is untouched.
    expect(clampToLimit('short', TEXT_MAX_CHARS)).toBe('short');
  });

  it('TC-06: non-finite create point → null, no object created', () => {
    const doc = makeDoc();
    expect(createText(doc, { x: NaN, y: 50 }, 'g')).toBeNull();
    expect(createText(doc, { x: 100, y: Infinity }, 'g')).toBeNull();
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('stale ids → false for every setter, no update', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    let updates = 0;
    textObj(doc, id).observe(() => updates++);

    expect(setTextSize(doc, 'does-not-exist', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'does-not-exist', 100)).toBe(false);
    expect(setTextBox(doc, 'does-not-exist', { width: 10, height: 10 })).toBe(false);
    expect(updates).toBe(0);
  });

  it('setTextBox writes a finite box; non-finite → false', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    expect(setTextBox(doc, id, { width: 120, height: 40 })).toBe(true);
    const obj = textObj(doc, id);
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(40);

    expect(setTextBox(doc, id, { width: NaN, height: 40 })).toBe(false);
    expect(obj.get('width')).toBe(120);
  });

  it('getTextContent returns the Y.Text; undefined for stale ids', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const t = getTextContent(doc, id);
    expect(t).toBeInstanceOf(Y.Text);
    t!.insert(0, 'hello');
    expect(getTextContent(doc, id)!.toString()).toBe('hello');
    expect(getTextContent(doc, 'nope')).toBeUndefined();
  });

  it('createText uses a LOCAL_ORIGIN transaction', () => {
    const doc = makeDoc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (txn) => origins.push(txn.origin));
    createText(doc, { x: 0, y: 0 }, 'g');
    expect(origins).toContain(LOCAL_ORIGIN);
  });
});
