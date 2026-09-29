// Story 9 `text.model` unit cases (TC-01 to TC-06): the text object schema and
// its mutations, against a real Y.Doc. Every setter is checked for the error path
// too — a stale id or bad argument must write nothing at all.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  textSnapshot,
} from '../../src/shared/objects/text.ts';
import {
  initDoc,
  createSticky,
  objectSnapshots,
} from '../../src/shared/board-model.ts';
import { clampToLimit, applyTextDiff } from '../../src/shared/text-edit.ts';
import {
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_MAX_AUTO_WIDTH_WORLD,
} from '../../src/shared/config.ts';

function objectsMapOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

describe('text.model', () => {
  it('TC-01 createText makes a size M auto-width empty text above everything', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).toBeTruthy();
    const snap = textSnapshot(doc, id)!;
    expect(snap.type).toBe('text');
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
    expect(snap.size).toBe(DEFAULT_TEXT_SIZE);
    expect(snap.widthMode).toBe('auto');
    expect(snap.text).toBe('');
    expect(snap.createdBy).toBe('g_test');
    // z above the sticky's z
    const sticky = objectSnapshots(doc).find((o) => o.type === 'sticky')!;
    expect(snap.z).toBeGreaterThan(sticky.z);
  });

  it('TC-02 setTextSize applies a known key, rejects an unknown one without an update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textSnapshot(doc, id)!.size).toBe('XL');
    let updates = 0;
    const h = () => updates++;
    doc.on('update', h);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates).toBe(0);
    doc.off('update', h);
  });

  it('TC-03 setTextWidthFixed clamps below the minimum and switches to fixed mode', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const snap = textSnapshot(doc, id)!;
    expect(snap.widthMode).toBe('fixed');
    expect(snap.width).toBe(TEXT_MIN_WIDTH_WORLD);
    // exact minimum accepted as-is
    setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
    expect(textSnapshot(doc, id)!.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-04 isEmptyText counts only zero characters; deleteIfEmpty removes it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(isEmptyText(doc, a)).toBe(true);
    // whitespace-only is kept (decision: only zero characters is empty)
    getTextContent(doc, a)!.insert(0, '  ');
    expect(isEmptyText(doc, a)).toBe(false);
    expect(deleteIfEmpty(doc, a)).toBe(false);
    expect(objectsMapOf(doc).has(a)).toBe(true);
    // remove the whitespace, then it is empty and removable
    getTextContent(doc, a)!.delete(0, 2);
    expect(isEmptyText(doc, a)).toBe(true);
    expect(deleteIfEmpty(doc, a)).toBe(true);
    expect(objectsMapOf(doc).has(a)).toBe(false);
  });

  it('TC-05 clampToLimit boundaries at TEXT_MAX_CHARS', () => {
    const long = 'x'.repeat(5001);
    expect(clampToLimit(long, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    const almost = 'x'.repeat(4999);
    expect(clampToLimit(almost + 'x', TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit(almost, TEXT_MAX_CHARS)).toBe(almost);
  });

  it('TC-05b applyTextDiff grows and shrinks a Y.Text minimally', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'abc');
    applyTextDiff(t, 'abXc', 'origin');
    expect(t.toString()).toBe('abXc');
    applyTextDiff(t, 'ab', 'origin');
    expect(t.toString()).toBe('ab');
  });

  it('TC-06 a non-finite create point returns null and writes no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const before = objectSnapshots(doc).length;
    let txns = 0;
    const h = () => txns++;
    doc.on('afterTransaction', h);
    expect(createText(doc, { x: NaN, y: 10 }, 'g')).toBeNull();
    expect(createText(doc, { x: 1, y: Infinity }, 'g')).toBeNull();
    doc.off('afterTransaction', h);
    expect(txns).toBe(0);
    expect(objectSnapshots(doc).length).toBe(before);
  });

  it('every setter rejects a stale id with false and no update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    const h = () => updates++;
    doc.on('update', h);
    expect(setTextSize(doc, 'nope', 'S')).toBe(false);
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
    expect(setTextBox(doc, 'nope', { width: 10, height: 10 })).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
    doc.off('update', h);
    expect(updates).toBe(0);
  });

  it('setTextBox rejects non-finite dimensions and stale ids', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextBox(doc, id, { width: NaN, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: -1 })).toBe(false);
    const s = textSnapshot(doc, id)!;
    // box was not rewritten with the bad values
    expect(Number.isFinite(s.width)).toBe(true);
  });

  it('setTextWidthFixed rejects a non-finite width', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
  });

  it('textSnapshot exposes a text object in objectSnapshots for the generic machinery', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 5, y: 7 }, 'g')!;
    const all = objectSnapshots(doc).find((o) => o.id === id)!;
    expect(all.type).toBe('text');
    expect(all.x).toBe(5);
    expect(all.y).toBe(7);
    expect(all.width).toBeGreaterThan(0);
    expect(all.height).toBeGreaterThan(0);
  });

  it('the size presets match the named settings', () => {
    for (const key of ['S', 'M', 'L', 'XL'] as const) {
      expect(TEXT_SIZES[key]).toBeGreaterThan(0);
    }
  });

  it('createText writes an initial box so selection bounds exist before first measure', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const s = textSnapshot(doc, id)!;
    expect(Number.isFinite(s.width) && s.width > 0).toBe(true);
    expect(Number.isFinite(s.height) && s.height > 0).toBe(true);
    expect(TEXT_MAX_AUTO_WIDTH_WORLD).toBeGreaterThan(0);
  });

});
