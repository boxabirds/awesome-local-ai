import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshotObjects, hasObject } from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import {
  createText, deleteIfEmpty, getTextContent, isEmptyText, setTextBox, setTextSize, setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import { newBoardDoc } from './helpers/peer';

function countUpdates(doc: Y.Doc): { n: number } {
  const c = { n: 0 };
  doc.on('update', () => { c.n += 1; });
  return c;
}

describe('text model', () => {
  it('TC-01 createText makes an empty auto-width size-M text on top', () => {
    const doc = newBoardDoc();
    createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test') as string;
    const all = snapshotObjects(doc);
    const t = all.find((o) => o.id === id) as TextSnapshot;
    expect(t.type).toBe('text');
    expect(t.x).toBe(100);
    expect(t.y).toBe(50);
    expect(t.size).toBe(DEFAULT_TEXT_SIZE);
    expect(t.widthMode).toBe('auto');
    expect(t.text).toBe('');
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect(t.z).toBeGreaterThan(all.find((o) => o.type === 'sticky')!.z);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('createdBy')).toBe('g_test');
  });

  it('TC-02 setTextSize applies a preset and rejects unknown keys', () => {
    const doc = newBoardDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g') as string;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect((snapshotObjects(doc)[0] as TextSnapshot).size).toBe('XL');
    const c = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(c.n).toBe(0);
  });

  it('TC-03 setTextWidthFixed clamps to the minimum and switches to fixed', () => {
    const doc = newBoardDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g') as string;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const t = snapshotObjects(doc)[0] as TextSnapshot;
    expect(t.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(t.widthMode).toBe('fixed');
    setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
    expect((snapshotObjects(doc)[0] as TextSnapshot).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-04 only zero characters count as empty', () => {
    const doc = newBoardDoc();
    const a = createText(doc, { x: 0, y: 0 }, 'g') as string;
    const b = createText(doc, { x: 0, y: 0 }, 'g') as string;
    getTextContent(doc, b)!.insert(0, '  ');
    expect(isEmptyText(doc, a)).toBe(true);
    expect(isEmptyText(doc, b)).toBe(false);
    expect(deleteIfEmpty(doc, b)).toBe(false);
    expect(hasObject(doc, b)).toBe(true);
    expect(deleteIfEmpty(doc, a)).toBe(true);
    expect(hasObject(doc, a)).toBe(false);
  });

  it('TC-05 clampToLimit boundaries', () => {
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS - 1) + 'y', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-06 non-finite point creates nothing', () => {
    const doc = newBoardDoc();
    const c = countUpdates(doc);
    expect(createText(doc, { x: NaN, y: 0 }, 'g')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'g')).toBeNull();
    expect(c.n).toBe(0);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('stale ids and bad numbers are rejected without an update', () => {
    const doc = newBoardDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g') as string;
    const c = countUpdates(doc);
    expect(setTextSize(doc, 'nope', 'S')).toBe(false);
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    expect(setTextBox(doc, 'nope', { width: 1, height: 1 })).toBe(false);
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
    expect(setTextBox(doc, id, { width: NaN, height: 5 })).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
    expect(getTextContent(doc, 'nope')).toBeUndefined();
    expect(c.n).toBe(0);
  });
});
