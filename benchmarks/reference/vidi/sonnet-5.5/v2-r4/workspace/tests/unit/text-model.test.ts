import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';

const updates = (doc: Y.Doc) => {
  const fn = vi.fn();
  doc.on('update', fn);
  return fn;
};
const textOf = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as TextSnapshot;

describe('text.model', () => {
  it('TC-01 createText: top-left at the point, size M, auto width, empty Y.Text, z on top', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const t = textOf(doc, id);
    expect(t).toMatchObject({ type: 'text', x: 100, y: 50, size: DEFAULT_TEXT_SIZE, widthMode: 'auto', text: '' });
    expect(t.z).toBeGreaterThan(Math.max(...snapshot(doc).filter((o) => o.id !== id).map((o) => o.z)));
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect((doc.getMap('objects').get(id) as Y.Map<unknown>).get('createdBy')).toBe('g_test');
    expect(t.width).toBeGreaterThan(0);
    expect(t.height).toBeGreaterThan(0);
  });

  it('TC-02 setTextSize applies a preset and rejects unknown keys without an update', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textOf(doc, id).size).toBe('XL');
    const fn = updates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 'toString')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(textOf(doc, id).size).toBe('XL');
  });

  it('TC-03 setTextWidthFixed clamps to the minimum and switches to fixed', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(textOf(doc, id)).toMatchObject({ width: TEXT_MIN_WIDTH_WORLD, widthMode: 'fixed' });
    setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
    expect(textOf(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD);
    setTextWidthFixed(doc, id, 250);
    expect(textOf(doc, id).width).toBe(250);
  });

  it('TC-04 only zero characters count as empty', () => {
    const doc = new Y.Doc();
    const a = createText(doc, { x: 0, y: 0 }, 'g')!;
    const b = createText(doc, { x: 0, y: 0 }, 'g')!;
    getTextContent(doc, b)!.insert(0, '  ');
    expect(isEmptyText(doc, a)).toBe(true);
    expect(isEmptyText(doc, b)).toBe(false);
    expect(deleteIfEmpty(doc, b)).toBe(false);
    expect(deleteIfEmpty(doc, a)).toBe(true);
    expect(snapshot(doc).map((o) => o.id)).toEqual([b]);
  });

  it('TC-05 clampToLimit keeps at most TEXT_MAX_CHARS', () => {
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS - 1) + 'b', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS - 1) + '\u{1F600}', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS - 1);
    const y = new Y.Doc().getText('t');
    applyTextDiff(y, 'hello', 'o');
    applyTextDiff(y, 'hello world', 'o');
    expect(y.toString()).toBe('hello world');
  });

  it('TC-06 a non-finite point creates nothing', () => {
    const doc = new Y.Doc();
    const fn = updates(doc);
    expect(createText(doc, { x: NaN, y: 0 }, 'g')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'g')).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('every setter rejects a stale id or a sticky without an update', () => {
    const doc = new Y.Doc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const fn = updates(doc);
    for (const id of ['missing', sticky]) {
      expect(setTextSize(doc, id, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, id, 100)).toBe(false);
      expect(setTextBox(doc, id, { width: 10, height: 10 })).toBe(false);
      expect(getTextContent(doc, id)).toBeUndefined();
      expect(isEmptyText(doc, id)).toBe(false);
      expect(deleteIfEmpty(doc, id)).toBe(false);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('setTextBox rejects non-finite numbers and skips an unchanged box', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextBox(doc, id, { width: 80, height: 26 })).toBe(true);
    const fn = updates(doc);
    expect(setTextBox(doc, id, { width: 80, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: NaN, height: 26 })).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
