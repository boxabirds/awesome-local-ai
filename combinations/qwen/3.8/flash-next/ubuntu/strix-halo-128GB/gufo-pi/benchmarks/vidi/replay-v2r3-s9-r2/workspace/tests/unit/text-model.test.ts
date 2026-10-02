/**
 * Unit tests for the text object model (story 9, text.model).
 * TC-01 to TC-06 run against a real Y.Doc.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  snapshotObjects,
  getObjectsMap,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { clampToLimit, applyTextDiff } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Records every document update so "no transaction" can be asserted. */
function watchUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return count;
  };
}

function textOf(doc: Y.Doc, id: string): TextSnapshot {
  const obj = snapshotObjects(doc).find((o) => o.id === id);
  if (!obj || obj.type !== 'text') throw new Error(`no text object ${id}`);
  return obj;
}

function rawMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = getObjectsMap(doc).get(id);
  if (!m) throw new Error(`no object ${id}`);
  return m;
}

describe('text.model — createText (TC-01)', () => {
  it('TC-01: creates a size M auto-width text whose top-left is the point, on top', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = snapshot(doc).find((n) => n.id === sticky)!.z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const obj = textOf(doc, id!);
    expect(obj.type).toBe('text');
    expect(obj.x).toBe(100);
    expect(obj.y).toBe(50);
    expect(obj.size).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.size).toBe('M');
    expect(obj.widthMode).toBe('auto');
    expect(obj.text).toBe('');
    expect(obj.z).toBeGreaterThan(stickyZ);
    expect(obj.createdBy).toBe('g_test');

    // The text is a real Y.Text so two people can type into it (text.concurrent).
    const ytext = getTextContent(doc, id!);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');

    // A finite box exists before the first measurement so bounds are usable.
    expect(Number.isFinite(obj.width)).toBe(true);
    expect(Number.isFinite(obj.height)).toBe(true);
  });

  it('TC-06: a non-finite point creates nothing and writes no transaction', () => {
    const doc = newDoc();
    for (const point of [
      { x: NaN, y: 10 },
      { x: 10, y: NaN },
      { x: Infinity, y: 10 },
      { x: 10, y: -Infinity },
    ]) {
      const stop = watchUpdates(doc);
      expect(createText(doc, point, 'g_test')).toBeNull();
      expect(stop()).toBe(0);
    }
    expect(snapshotObjects(doc)).toHaveLength(0);
  });
});

describe('text.model — setTextSize (TC-02)', () => {
  it('TC-02: applies a known preset and rejects an unknown one without a transaction', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 10, y: 10 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textOf(doc, id).size).toBe('XL');

    const stop = watchUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(stop()).toBe(0);
    expect(textOf(doc, id).size).toBe('XL');

    // The stored size is the preset key, so it survives a reload (low reversibility).
    expect(rawMap(doc, id).get('size')).toBe('XL');

    // Every preset is addressable.
    for (const size of Object.keys(TEXT_SIZES)) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(textOf(doc, id).size).toBe(size);
    }
  });
});

describe('text.model — setTextWidthFixed (TC-03)', () => {
  it('TC-03: clamps to TEXT_MIN_WIDTH_WORLD and switches to fixed mode', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const obj = textOf(doc, id);
    expect(obj.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.widthMode).toBe('fixed');

    // Exactly the minimum is accepted.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false); // unchanged
    expect(textOf(doc, id).width).toBe(TEXT_MIN_WIDTH_WORLD);

    // A wider width is stored as asked.
    expect(setTextWidthFixed(doc, id, 320)).toBe(true);
    expect(textOf(doc, id).width).toBe(320);

    // Non-finite widths are rejected without a transaction.
    const stop = watchUpdates(doc);
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Infinity)).toBe(false);
    expect(stop()).toBe(0);
    expect(textOf(doc, id).width).toBe(320);
  });
});

describe('text.model — empty text (TC-04)', () => {
  it('TC-04: zero characters are empty, whitespace-only text is kept', () => {
    const doc = newDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(snapshotObjects(doc).find((o) => o.id === empty)).toBeUndefined();

    const blank = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    applyTextDiff(getTextContent(doc, blank)!, '   ', LOCAL_ORIGIN);
    expect(isEmptyText(doc, blank)).toBe(false);
    const stop = watchUpdates(doc);
    expect(deleteIfEmpty(doc, blank)).toBe(false);
    expect(stop()).toBe(0);
    expect(snapshotObjects(doc).find((o) => o.id === blank)).toBeDefined();
  });
});

describe('text.model — length limit (TC-05)', () => {
  it('TC-05: clamps to TEXT_MAX_CHARS at the boundaries', () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);

    const under = 'a'.repeat(TEXT_MAX_CHARS - 1) + 'b';
    expect(under).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(under, TEXT_MAX_CHARS)).toBe(under);

    // 4,999 characters plus one more is accepted exactly.
    const atLimit = 'a'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(atLimit + 'z', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);

    // A surrogate pair straddling the limit is dropped whole.
    const pair = 'a'.repeat(TEXT_MAX_CHARS - 1) + '\u{1F600}';
    const clamped = clampToLimit(pair, TEXT_MAX_CHARS);
    expect(clamped).toHaveLength(TEXT_MAX_CHARS - 1);
    expect(clamped).toBe('a'.repeat(TEXT_MAX_CHARS - 1));
  });

  it('applyTextDiff keeps concurrent typing (minimal diff, shared helper)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    applyTextDiff(ytext, 'Went well', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Went well');
    expect(textOf(doc, id).text).toBe('Went well');
  });
});

describe('text.model — setTextBox (text.height)', () => {
  it('stores a measured box, rejects unchanged, stale and non-finite input', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    const obj = textOf(doc, id);
    expect(obj.width).toBe(120);
    expect(obj.height).toBe(26);
    expect(obj.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT * 1, 6);

    // Unchanged → false and no transaction.
    const stop = watchUpdates(doc);
    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(false);
    expect(stop()).toBe(0);

    // Non-finite → false and no transaction.
    expect(setTextBox(doc, id, { width: NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 120, height: Infinity })).toBe(false);
    expect(stop()).toBe(0);
    expect(textOf(doc, id).width).toBe(120);

    // Auto width never exceeds the maximum through the model either.
    expect(setTextWidthFixed(doc, id, 5000)).toBe(true);
    expect(textOf(doc, id).width).toBe(5000); // fixed widths are the user's choice
    expect(TEXT_MAX_AUTO_WIDTH_WORLD).toBe(600);
  });
});

describe('text.model — stale ids', () => {
  it('every setter returns false for a missing id and writes no transaction', () => {
    const doc = newDoc();
    const missing = '00000000-0000-4000-8000-000000000000';
    const stop = watchUpdates(doc);
    expect(setTextSize(doc, missing, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, missing, 100)).toBe(false);
    expect(setTextBox(doc, missing, { width: 100, height: 20 })).toBe(false);
    expect(deleteIfEmpty(doc, missing)).toBe(false);
    expect(getTextContent(doc, missing)).toBeUndefined();
    expect(isEmptyText(doc, missing)).toBe(false);
    expect(stop()).toBe(0);
  });

  it('setters reject ids that belong to another object type', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const stop = watchUpdates(doc);
    expect(setTextSize(doc, sticky, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, sticky, 100)).toBe(false);
    expect(setTextBox(doc, sticky, { width: 10, height: 10 })).toBe(false);
    expect(getTextContent(doc, sticky)).toBeUndefined();
    expect(stop()).toBe(0);
  });

  it('createText works with an empty creator id (no identity available)', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 5, y: 5 }, '');
    expect(id).toBeTruthy();
    expect(textOf(doc, id!).createdBy).toBe('');
  });
});

