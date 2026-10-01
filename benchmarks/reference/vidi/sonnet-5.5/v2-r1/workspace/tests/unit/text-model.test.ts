import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function updates(doc: Y.Doc) {
  let n = 0;
  doc.on('update', () => n++);
  return () => n;
}

describe('text model', () => {
  it('TC-01 createText makes an empty size M auto-width text on top', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 }) as string;
    const id = createText(doc, { x: 100, y: 50 }, 'g_test') as string;
    const snap = snapshot(doc);
    const text = snap.find((o) => o.id === id) as TextSnapshot;
    expect(text.type).toBe('text');
    expect(text).toMatchObject({ x: 100, y: 50, size: DEFAULT_TEXT_SIZE, widthMode: 'auto', text: '' });
    expect(getTextContent(doc, id)?.length).toBe(0);
    expect(text.z).toBeGreaterThan(snap.find((o) => o.id === sticky)?.z ?? 0);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('createdBy')).toBe('g_test');
  });

  it('TC-02 setTextSize applies a preset and rejects unknown keys', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'u') as string;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect((snapshot(doc)[0] as TextSnapshot).size).toBe('XL');
    const count = updates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(count()).toBe(0);
  });

  it('TC-03 setTextWidthFixed clamps to the minimum and switches to fixed', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'u') as string;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const t = snapshot(doc)[0] as TextSnapshot;
    expect(t.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(t.widthMode).toBe('fixed');
  });

  it('TC-04 only zero characters counts as empty', () => {
    const doc = newDoc();
    const a = createText(doc, { x: 0, y: 0 }, 'u') as string;
    const b = createText(doc, { x: 0, y: 0 }, 'u') as string;
    getTextContent(doc, b)?.insert(0, '  ');
    expect(isEmptyText(doc, a)).toBe(true);
    expect(isEmptyText(doc, b)).toBe(false);
    expect(deleteIfEmpty(doc, b)).toBe(false);
    expect(deleteIfEmpty(doc, a)).toBe(true);
    expect(snapshot(doc).map((o) => o.id)).toEqual([b]);
  });

  it('TC-05 clampToLimit keeps at most TEXT_MAX_CHARS', () => {
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS - 1) + 'y', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-06 a non-finite point creates nothing', () => {
    const doc = newDoc();
    const count = updates(doc);
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'u')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'u')).toBeNull();
    expect(count()).toBe(0);
  });

  it('stale ids and bad numbers are rejected without an update', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'u') as string;
    const count = updates(doc);
    expect(setTextSize(doc, 'nope', 'S')).toBe(false);
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    expect(setTextBox(doc, 'nope', { width: 1, height: 1 })).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 1 })).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
    expect(isEmptyText(doc, 'nope')).toBe(false);
    expect(count()).toBe(0);
  });
});
