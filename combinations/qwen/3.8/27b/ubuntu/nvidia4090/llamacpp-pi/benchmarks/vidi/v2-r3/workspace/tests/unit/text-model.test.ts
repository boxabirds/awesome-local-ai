/**
 * Story 9 unit tests (TC-01 to TC-06): the text object model (text.model)
 * against a real Y.Doc.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function item(doc: Y.Doc, id: string): Y.Map<any> {
  return doc.getMap('objects').get(id) as Y.Map<any>;
}

function itemCount(doc: Y.Doc): number {
  return doc.getMap('objects').size;
}

describe('text.model', () => {
  it('TC-01: createText makes a size M auto-width text, z above all, createdBy set', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 }); // z = 1
    let updates = 0;
    doc.on('update', () => updates++);
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();
    expect(updates).toBe(1); // one transaction
    const o = item(doc, id!);
    expect(o.get('type')).toBe('text');
    expect(o.get('x')).toBe(100);
    expect(o.get('y')).toBe(50);
    expect(o.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(o.get('widthMode')).toBe('auto');
    expect(o.get('createdBy')).toBe('g_test');
    const t = o.get('text');
    expect(t instanceof Y.Text).toBe(true);
    expect(t.toString()).toBe('');
    expect(o.get('z')).toBe(2); // above the existing sticky
    expect(typeof o.get('width')).toBe('number'); // initial box exists
    expect(typeof o.get('height')).toBe('number');
    expect(typeof o.get('createdAt')).toBe('number');
  });

  it("TC-02: setTextSize applies a known size; unknown key → false, no update", () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    let updates = 0;
    doc.on('update', () => updates++);
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(item(doc, id).get('size')).toBe('XL');
    expect(updates).toBe(1);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates).toBe(1); // the error path wrote nothing
  });

  it('TC-03: setTextWidthFixed below the minimum clamps to TEXT_MIN_WIDTH_WORLD', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const o = item(doc, id);
    expect(o.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(o.get('widthMode')).toBe('fixed');
    // A width above the minimum is stored as given.
    expect(setTextWidthFixed(doc, id, 300)).toBe(true);
    expect(item(doc, id).get('width')).toBe(300);
  });

  it('TC-04: zero characters is empty (removed); whitespace-only is kept', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(itemCount(doc)).toBe(0);

    const id2 = createText(doc, { x: 0, y: 0 }, 'g')!;
    const t = getTextContent(doc, id2)!;
    doc.transact(() => t.insert(0, '   '), LOCAL_ORIGIN);
    expect(isEmptyText(doc, id2)).toBe(false); // whitespace-only is NOT empty
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(itemCount(doc)).toBe(1);
  });

  it('TC-05: clampToLimit enforces TEXT_MAX_CHARS at the boundaries', () => {
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS - 1) + 'b', TEXT_MAX_CHARS)).toHaveLength(
      TEXT_MAX_CHARS,
    ); // 4,999 + 1 is accepted
    expect(clampToLimit('short', TEXT_MAX_CHARS)).toBe('short');
    expect(clampToLimit('', TEXT_MAX_CHARS)).toBe('');
  });

  it('TC-06: a non-finite create point → null, no transaction', () => {
    const doc = newDoc();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(createText(doc, { x: Number.NaN, y: 50 }, 'g')).toBeNull();
    expect(createText(doc, { x: 100, y: Number.POSITIVE_INFINITY }, 'g')).toBeNull();
    expect(updates).toBe(0);
    expect(itemCount(doc)).toBe(0);
  });

  it('stale ids are rejected by every setter without an update', () => {
    const doc = newDoc();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(setTextSize(doc, 'stale', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'stale', 100)).toBe(false);
    expect(setTextBox(doc, 'stale', { width: 10, height: 5 })).toBe(false);
    expect(setTextBox(doc, 'stale', { width: Number.NaN, height: 5 })).toBe(false);
    expect(isEmptyText(doc, 'stale')).toBe(false);
    expect(deleteIfEmpty(doc, 'stale')).toBe(false);
    expect(getTextContent(doc, 'stale')).toBeUndefined();
    expect(updates).toBe(0);
  });
});
