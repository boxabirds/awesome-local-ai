// text.model unit tests (story 9, TC-01 to TC-06) against a real Y.Doc.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  clampToLimit,
  applyTextDiff,
} from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
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

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** The text object snapshot with its typed fields, by id. */
function textById(doc: Y.Doc, id: string): TextSnapshot {
  const found = snapshot(doc).find((o) => o.id === id);
  expect(found, `text ${id} missing from snapshot`).toBeDefined();
  return found as TextSnapshot;
}

/** Number of doc transactions that happen while `fn` runs. */
function withDocTransactions(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('afterTransaction', listener);
  try {
    fn();
  } finally {
    doc.off('afterTransaction', listener);
  }
  return count;
}

describe('text.model', () => {
  it('TC-01 createText at (100,50) → type text, size M, auto width, empty Y.Text, z above existing objects, createdBy set', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const snap = textById(doc, id!);
    expect(snap.type).toBe('text');
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
    expect(snap.size).toBe(DEFAULT_TEXT_SIZE);
    expect(snap.widthMode).toBe('auto');
    expect(snap.text).toBe('');

    // z is above every existing object.
    const sticky = snapshot(doc).find((o) => o.type === 'sticky')!;
    expect(snap.z).toBeGreaterThan(sticky.z);

    // createdBy comes from the identity argument.
    const raw = objects(doc).get(id!);
    expect(raw?.get('createdBy')).toBe('g_test');

    // Empty Y.Text attached.
    const ytext = raw?.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');
  });

  it('TC-02 setTextSize XL applies; unknown size "XXL" → false with no update event', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textById(doc, id).size).toBe('XL');
    expect(TEXT_SIZES.XL).toBe(56);

    const raw = objects(doc).get(id)!;
    let events = 0;
    const listener = (): void => {
      events += 1;
    };
    raw.observe(listener);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    raw.unobserve(listener);
    expect(events).toBe(0);
    expect(textById(doc, id).size).toBe('XL'); // unchanged
  });

  it('TC-03 setTextWidthFixed 30 → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed (boundary)', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(TEXT_MIN_WIDTH_WORLD).toBe(40);
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const snap = textById(doc, id);
    expect(snap.widthMode).toBe('fixed');
    expect(snap.width).toBe(TEXT_MIN_WIDTH_WORLD);

    // Exact minimum is accepted; a normal value passes through.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(textById(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(textById(doc, id).width).toBe(120);
  });

  it('TC-04 isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only is kept', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(snapshot(doc).some((o) => o.id === id)).toBe(false);

    // Whitespace-only text is NOT empty (zero characters only counts).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    applyTextDiff(getTextContent(doc, id2)!, '  ', 'test');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(snapshot(doc).some((o) => o.id === id2)).toBe(true);

    // deleteIfEmpty on a non-empty text does not remove.
    applyTextDiff(getTextContent(doc, id2)!, 'x', 'test');
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(snapshot(doc).some((o) => o.id === id2)).toBe(true);

    // Stale id → false.
    expect(deleteIfEmpty(doc, 'missing')).toBe(false);
  });

  it('TC-05 clampToLimit with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)', () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1); // 5,001
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    const at4999 = 'b'.repeat(4999);
    const kept = clampToLimit(at4999 + 'c', TEXT_MAX_CHARS);
    expect(kept).toHaveLength(5000);
    expect(kept.endsWith('c')).toBe(true);
  });

  it('TC-06 non-finite create point → null, no transaction (error path)', () => {
    const doc = freshDoc();
    const id = withDocTransactions(doc, () => {
      expect(createText(doc, { x: NaN, y: 10 }, 'g_test')).toBeNull();
      expect(createText(doc, { x: 10, y: Infinity }, 'g_test')).toBeNull();
    });
    expect(id).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('stale ids: every setter → false, no update', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const raw = objects(doc).get(id)!;
    let events = 0;
    const listener = (): void => {
      events += 1;
    };
    raw.observe(listener);

    expect(setTextSize(doc, 'missing', 'S')).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 10, height: 10 })).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextBox(doc, id, { width: NaN, height: 5 })).toBe(false);

    raw.unobserve(listener);
    expect(events).toBe(0);

    // A valid setTextBox writes width and height.
    expect(setTextBox(doc, id, { width: 77, height: 26 })).toBe(true);
    const snap = textById(doc, id);
    expect(snap.width).toBe(77);
    expect(snap.height).toBe(26);
    expect(TEXT_MAX_AUTO_WIDTH_WORLD).toBe(600);

    // getTextContent on a stale id → undefined.
    expect(getTextContent(doc, 'missing')).toBeUndefined();
  });
});
