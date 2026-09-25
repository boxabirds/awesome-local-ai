/**
 * text.model (story 9) against a real Y.Doc: TC-01 to TC-06, plus stale ids for every setter.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, objectSnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import { PROSE_1000 } from '../fixtures/texts';

const AUTHOR = 'g_test';
const AT = { x: 100, y: 50 } as const;
const STALE = 'no-such-id';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { doc, updates: () => updates };
}

function onlyText(doc: Y.Doc) {
  const texts = objectSnapshot(doc).filter(isText);
  expect(texts).toHaveLength(1);
  return texts[0]!;
}

/** A paragraph of exactly `n` characters of real prose. */
function prose(n: number): string {
  let s = '';
  while (s.length < n) s += `${PROSE_1000} `;
  return s.slice(0, n);
}

describe('text.model', () => {
  it('TC-01 createText: type text, size M, auto width, empty Y.Text, z on top, createdBy set', () => {
    const { doc } = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const topBefore = Math.max(...objectSnapshot(doc).map((o) => o.z));
    const id = createText(doc, AT, AUTHOR);
    expect(id).toEqual(expect.any(String));
    const text = onlyText(doc);
    expect(text).toMatchObject({
      id,
      type: 'text',
      x: AT.x,
      y: AT.y,
      size: DEFAULT_TEXT_SIZE,
      widthMode: 'auto',
      text: '',
      createdBy: AUTHOR,
    });
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(text.z).toBeGreaterThan(topBefore);
    expect(text.width).toBeGreaterThan(0);
    expect(text.height).toBeGreaterThan(0);
    const ytext = getTextContent(doc, id!);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.length).toBe(0);
  });

  it('TC-02 setTextSize XL applies; an unknown key XXL is rejected with no update (error path)', () => {
    const { doc, updates } = newDoc();
    const id = createText(doc, AT, AUTHOR)!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(onlyText(doc).size).toBe('XL');
    const before = updates();
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 'XL')).toBe(false); // no-op
    expect(updates()).toBe(before);
    expect(onlyText(doc).size).toBe('XL');
  });

  it('TC-03 setTextWidthFixed 30 is clamped to TEXT_MIN_WIDTH_WORLD and switches to fixed (boundary)', () => {
    const { doc, updates } = newDoc();
    const id = createText(doc, AT, AUTHOR)!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(onlyText(doc)).toMatchObject({ width: TEXT_MIN_WIDTH_WORLD, widthMode: 'fixed' });
    const before = updates();
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false); // already there
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(updates()).toBe(before);
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD + 1)).toBe(true);
    expect(onlyText(doc).width).toBe(TEXT_MIN_WIDTH_WORLD + 1);
  });

  it('TC-04 zero characters is empty and deleteIfEmpty removes it; whitespace-only text is kept (negative)', () => {
    const { doc } = newDoc();
    const empty = createText(doc, AT, AUTHOR)!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectSnapshot(doc)).toHaveLength(0);

    const spaces = createText(doc, AT, AUTHOR)!;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(onlyText(doc).text).toBe('  ');
  });

  it('TC-05 clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    const over = prose(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe(over.slice(0, TEXT_MAX_CHARS));
    const almost = prose(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${almost}!`, TEXT_MAX_CHARS)).toBe(`${almost}!`);
    expect(clampToLimit(`${almost}!`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    // An emoji straddling the limit is dropped whole, never split.
    expect(clampToLimit(`${almost}😀`, TEXT_MAX_CHARS)).toBe(almost);
  });

  it('TC-06 a non-finite point returns null and opens no transaction (error path)', () => {
    const { doc, updates } = newDoc();
    const before = updates();
    expect(createText(doc, { x: Number.NaN, y: 0 }, AUTHOR)).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, AUTHOR)).toBeNull();
    expect(updates()).toBe(before);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('every setter rejects a stale id and a sticky note without an update', () => {
    const { doc, updates } = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const before = updates();
    for (const id of [STALE, sticky]) {
      expect(setTextSize(doc, id, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, id, 100)).toBe(false);
      expect(setTextBox(doc, id, { width: 100, height: 20 })).toBe(false);
      expect(getTextContent(doc, id)).toBeUndefined();
      expect(isEmptyText(doc, id)).toBe(false);
      expect(deleteIfEmpty(doc, id)).toBe(false);
    }
    expect(updates()).toBe(before);
  });

  it('setTextBox writes a changed box once and rejects unchanged, non-finite and non-positive boxes', () => {
    const { doc, updates } = newDoc();
    const id = createText(doc, AT, AUTHOR)!;
    const before = updates();
    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(true);
    expect(updates()).toBe(before + 1);
    expect(setTextBox(doc, id, { width: 90, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 0, height: 26 })).toBe(false);
    expect(updates()).toBe(before + 1);
    expect(onlyText(doc)).toMatchObject({ width: 90, height: 26 });
  });
});
