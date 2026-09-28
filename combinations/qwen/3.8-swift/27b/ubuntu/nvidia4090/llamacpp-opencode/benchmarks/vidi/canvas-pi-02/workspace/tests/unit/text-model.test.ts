// Unit tests for the text object model (story 9, text.model): TC-01 to
// TC-06 plus stale-id rejections, against a real Y.Doc. Each successful
// mutation must emit exactly one update event (one LOCAL_ORIGIN
// transaction).

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createSticky, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  createText,
  deleteIfEmpty,
  isEmptyText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  textSnapshot,
} from '../../src/shared/objects/text';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function spyUpdates(doc: Y.Doc): { count: number; off(): void } {
  let count = 0;
  const handler = (): void => {
    count += 1;
  };
  doc.on('update', handler);
  return {
    get count() {
      return count;
    },
    off: () => doc.off('update', handler),
  };
}

describe('text.model: create (real Y.Doc)', () => {
  it('TC-01: createText at (100,50) → type text, size M, auto width, empty Y.Text, z on top, createdBy set', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');

    expect(id).not.toBeNull();
    const snap = textSnapshot(doc, id!);
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe('text');
    expect(snap!.x).toBe(100);
    expect(snap!.y).toBe(50);
    expect(snap!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(snap!.widthMode).toBe('auto');
    expect(snap!.text).toBe('');
    // The Y.Text must be a real bound Y.Text.
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    const ytext = entry.get('text');
    expect(ytext).toBeInstanceOf(Y.Text);
    expect((ytext as Y.Text).toString()).toBe('');
    // z above the pre-existing object (createdBy recorded).
    expect(snap!.z).toBeGreaterThan((objectsSnapshot(doc).find((o) => o.id === sticky)!.z as number));
    expect(entry.get('createdBy')).toBe('g_test');
    // A finite initial box exists before the first measure.
    expect(Number.isFinite(snap!.width)).toBe(true);
    expect(Number.isFinite(snap!.height)).toBe(true);
    expect(snap!.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * 1.3);
  });

  it('TC-06: non-finite create point → null, no transaction (error path)', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);

    expect(createText(doc, { x: Number.NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 100, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(updates.count).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
    updates.off();
  });
});

describe('text.model: size (real Y.Doc)', () => {
  it('TC-02: setTextSize XL applied; unknown key → false and no update (error path)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = spyUpdates(doc);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textSnapshot(doc, id)!.size).toBe('XL');
    expect(updates.count).toBe(1);

    // Unknown preset key: rejected, no transaction.
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 'm')).toBe(false);
    expect(setTextSize(doc, id, 42 as unknown as string)).toBe(false);
    expect(textSnapshot(doc, id)!.size).toBe('XL');
    expect(updates.count).toBe(1);

    // Same size again: no-op, no transaction.
    expect(setTextSize(doc, id, 'XL')).toBe(false);
    expect(updates.count).toBe(1);
    updates.off();
  });

  it('stale id → false, no update', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);
    expect(setTextSize(doc, 'missing', 'L')).toBe(false);
    expect(updates.count).toBe(0);
    updates.off();
  });
});

describe('text.model: fixed width (real Y.Doc)', () => {
  it('TC-03: setTextWidthFixed below the minimum clamps to TEXT_MIN_WIDTH_WORLD and sets widthMode fixed (boundary)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const updates = spyUpdates(doc);

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const snap = textSnapshot(doc, id)!;
    expect(snap.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(snap.widthMode).toBe('fixed');
    expect(updates.count).toBe(1);

    // Non-finite width: rejected, no transaction.
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(updates.count).toBe(1);
    updates.off();
  });

  it('stale id → false, no update', () => {
    const doc = newDoc();
    const updates = spyUpdates(doc);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(updates.count).toBe(0);
    updates.off();
  });
});

describe('text.model: empty removal (real Y.Doc)', () => {
  it('TC-04: zero characters → isEmptyText true, deleteIfEmpty removes; whitespace-only is kept (negative)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(textSnapshot(doc, id)).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);

    // Whitespace-only text is NOT empty (only zero characters counts).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = (doc.getMap('objects').get(id2) as Y.Map<unknown>).get('text') as Y.Text;
    ytext.insert(0, '  ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(textSnapshot(doc, id2)!.text).toBe('  ');
  });

  it('stale id → false, no error', () => {
    const doc = newDoc();
    expect(isEmptyText(doc, 'missing')).toBe(false);
    expect(deleteIfEmpty(doc, 'missing')).toBe(false);
  });
});

describe('text.model: length clamp (shared helper)', () => {
  it('TC-05: clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)', () => {
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit('a'.repeat(4999) + 'b', TEXT_MAX_CHARS)).toBe('a'.repeat(4999) + 'b');
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS), TEXT_MAX_CHARS)).toBe('a'.repeat(TEXT_MAX_CHARS));
  });
});

describe('text.model: box writes (real Y.Doc)', () => {
  it('setTextBox writes width/height once; no-op returns false; stale id and non-finite reject', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const snap0 = textSnapshot(doc, id)!;
    const updates = spyUpdates(doc);

    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    expect(updates.count).toBe(1);
    const snap1 = textSnapshot(doc, id)!;
    expect(snap1.width).toBe(120);
    expect(snap1.height).toBe(26);

    // Exact no-op: no transaction.
    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(false);
    expect(updates.count).toBe(1);

    // Non-finite: rejected, no transaction.
    expect(setTextBox(doc, id, { width: Number.NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 120, height: Number.NEGATIVE_INFINITY })).toBe(false);
    expect(updates.count).toBe(1);

    // Stale id: rejected.
    expect(setTextBox(doc, 'missing', { width: 1, height: 1 })).toBe(false);
    expect(updates.count).toBe(1);
    expect(textSnapshot(doc, id)!.width).toBe(120);

    // The initial box (pre-measure) was finite and positive height.
    expect(snap0.height).toBeGreaterThan(0);
    expect(TEXT_MAX_AUTO_WIDTH_WORLD).toBe(600);
    updates.off();
  });
});
