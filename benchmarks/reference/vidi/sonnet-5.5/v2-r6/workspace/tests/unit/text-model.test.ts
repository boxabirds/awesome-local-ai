import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc } from '../../src/shared/board-model';
import {
  createText, deleteIfEmpty, getTextContent, isEmptyText, setTextBox, setTextSize, setTextWidthFixed,
} from '../../src/shared/objects/text';
import { DEFAULT_TEXT_SIZE, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  return { doc, updates };
}
const obj = (doc: Y.Doc, id: string) => doc.getMap('objects').get(id) as Y.Map<unknown>;

describe('text model', () => {
  it('TC-01 createText places an empty auto-width text of size M with its top-left at the point', () => {
    const { doc } = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test') as string;
    const m = obj(doc, id);
    expect(m.get('type')).toBe('text');
    expect(m.get('x')).toBe(100);
    expect(m.get('y')).toBe(50);
    expect(m.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(m.get('widthMode')).toBe('auto');
    expect(m.get('createdBy')).toBe('g_test');
    expect(m.get('text')).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id)!.length).toBe(0);
    const stickyZ = [...doc.getMap('objects').values()].find((o) => (o as Y.Map<unknown>).get('type') === 'sticky') as Y.Map<unknown>;
    expect(m.get('z') as number).toBeGreaterThan(stickyZ.get('z') as number);
  });

  it('TC-02 setTextSize applies a known size and rejects an unknown one without an update', () => {
    const { doc, updates } = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g') as string;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(obj(doc, id).get('size')).toBe('XL');
    const n = updates.length;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates.length).toBe(n);
    expect(obj(doc, id).get('size')).toBe('XL');
  });

  it('TC-03 setTextWidthFixed clamps to the minimum width and switches to fixed', () => {
    const { doc } = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g') as string;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(obj(doc, id).get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj(doc, id).get('widthMode')).toBe('fixed');
    expect(setTextWidthFixed(doc, id, 300)).toBe(true);
    expect(obj(doc, id).get('width')).toBe(300);
  });

  it('TC-04 only zero characters count as empty; deleteIfEmpty removes just those', () => {
    const { doc } = newDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g') as string;
    const spaces = createText(doc, { x: 0, y: 0 }, 'g') as string;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(doc.getMap('objects').has(spaces)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(doc.getMap('objects').has(empty)).toBe(false);
  });

  it('TC-05 clampToLimit keeps 5,000 characters', () => {
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS - 1) + 'y', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-06 a non-finite point creates nothing and makes no transaction', () => {
    const { doc, updates } = newDoc();
    const n = updates.length;
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g')).toBeNull();
    expect(createText(doc, { x: 0, y: Infinity }, 'g')).toBeNull();
    expect(updates.length).toBe(n);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('every setter rejects a stale id without an update', () => {
    const { doc, updates } = newDoc();
    const n = updates.length;
    expect(setTextSize(doc, 'gone', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 10, height: 10 })).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    expect(updates.length).toBe(n);
  });

  it('setTextBox rejects non-finite numbers and unchanged boxes', () => {
    const { doc, updates } = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g') as string;
    expect(setTextBox(doc, id, { width: 50, height: 26 })).toBe(true);
    const n = updates.length;
    expect(setTextBox(doc, id, { width: 50, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 26 })).toBe(false);
    expect(updates.length).toBe(n);
  });
});
