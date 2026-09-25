import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, LOCAL_ORIGIN, objectSnapshot, registerModelObjectType } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  STICKY_TEXT_MAX_CHARS,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  readText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import * as sticky from '../../src/client/objects/StickyText';

// The client registry makes 'text' a known type; the model tests do the same without React.
registerModelObjectType('text');

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const on = () => n++;
  doc.on('update', on);
  try {
    fn();
  } finally {
    doc.off('update', on);
  }
  return n;
}

function raw(doc: Y.Doc, id: string) {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!;
}

describe('text model', () => {
  it('TC-01 createText makes an empty size M auto-width text above everything, with its author', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).toBeTruthy();
    const obj = raw(doc, id);
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    expect(typeof obj.get('createdAt')).toBe('number');
    const text = obj.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).length).toBe(0);
    expect(obj.get('width')).toBeGreaterThan(0);
    expect(obj.get('height')).toBeGreaterThan(0);
    const all = objectSnapshot(doc);
    expect(all[all.length - 1].id).toBe(id);
    expect(all[all.length - 1].z).toBeGreaterThan(all[0].z);
    const snap = all.find((o) => o.id === id) as TextSnapshot;
    expect(snap).toMatchObject({ type: 'text', text: '', size: 'M', widthMode: 'auto', x: 100, y: 50 });
  });

  it('TC-02 setTextSize applies a preset; an unknown size is rejected without an update', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(readText(doc, id)!.size).toBe('XL');
    let result = true;
    expect(countUpdates(doc, () => (result = setTextSize(doc, id, 'XXL')))).toBe(0);
    expect(result).toBe(false);
    expect(readText(doc, id)!.size).toBe('XL');
    // Same size again: no-op.
    expect(countUpdates(doc, () => (result = setTextSize(doc, id, 'XL')))).toBe(0);
    expect(result).toBe(false);
    // Size change keeps the top-left.
    expect(readText(doc, id)).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-03 setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and switches to fixed width', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(readText(doc, id)).toMatchObject({ width: TEXT_MIN_WIDTH_WORLD, widthMode: 'fixed' });
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false);
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(readText(doc, id)!.width).toBe(250);
    expect(countUpdates(doc, () => setTextWidthFixed(doc, id, Number.NaN))).toBe(0);
  });

  it('TC-04 only zero characters count as empty: deleteIfEmpty removes empty text and keeps whitespace', () => {
    const doc = freshDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g')!;
    const spaces = createText(doc, { x: 0, y: 100 }, 'g')!;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(readText(doc, spaces)).toBeDefined();
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(readText(doc, empty)).toBeUndefined();
    expect(objectSnapshot(doc).map((o) => o.id)).toEqual([spaces]);
    expect(isEmptyText(doc, empty)).toBe(false); // stale id
  });

  it('TC-05 clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 is accepted', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    expect(clampToLimit('a'.repeat(5001), TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit('a'.repeat(4999) + 'b', TEXT_MAX_CHARS)).toBe('a'.repeat(4999) + 'b');
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const ytext = getTextContent(doc, id)!;
    applyTextDiff(ytext, clampToLimit('x'.repeat(5001), TEXT_MAX_CHARS), LOCAL_ORIGIN);
    expect(ytext.length).toBe(5000);
  });

  it('StickyText keeps its story 2 exports with the note limit as default', () => {
    expect(sticky.clampToLimit('a'.repeat(STICKY_TEXT_MAX_CHARS + 1))).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(sticky.applyTextDiff).toBe(applyTextDiff);
  });

  it('TC-06 a non-finite point creates nothing and opens no transaction', () => {
    const doc = freshDoc();
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g')).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g')).toBeNull();
    expect(transactions).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('every setter rejects a stale id or a non-text object without an update', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    for (const id of ['missing', note]) {
      const n = countUpdates(doc, () => {
        expect(setTextSize(doc, id, 'L')).toBe(false);
        expect(setTextWidthFixed(doc, id, 100)).toBe(false);
        expect(setTextBox(doc, id, { width: 10, height: 10 })).toBe(false);
        expect(deleteIfEmpty(doc, id)).toBe(false);
      });
      expect(n).toBe(0);
      expect(getTextContent(doc, id)).toBeUndefined();
    }
  });

  it('setTextBox writes only a changed, positive, finite box', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(true);
    expect(readText(doc, id)).toMatchObject({ width: 90, height: 26 });
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 90, height: 26 }))).toBe(0);
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 0, height: 26 }))).toBe(0);
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: Number.NaN, height: 26 }))).toBe(0);
  });
});
