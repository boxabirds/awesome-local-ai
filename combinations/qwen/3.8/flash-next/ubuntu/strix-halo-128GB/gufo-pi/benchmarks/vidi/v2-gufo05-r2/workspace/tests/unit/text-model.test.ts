/**
 * Story 9, `text.model`: the text object's schema rules, against a real Y.Doc.
 *
 * TC-01 … TC-06 plus the stale-id rule every setter shares. The assertions are
 * about the document: what fields a text object carries, what a rejected call
 * leaves untouched, and where the limits bite.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createSticky,
  objectSnapshots,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isTextSnapshot,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import type { TextSnapshot } from '../../src/shared/objects/text';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function entryOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  const entry = objectsMap(doc).get(id);
  if (!entry) throw new Error(`object ${id} is missing`);
  return entry;
}

/** Run `fn`, counting the `update` events the doc emits. */
function withUpdateCount<T>(doc: Y.Doc, fn: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: fn(), updates };
  } finally {
    doc.off('update', observer);
  }
}

/** The text snapshot with this id, or undefined. */
function textOf(doc: Y.Doc, id: string): TextSnapshot | undefined {
  return objectSnapshots(doc).find(
    (object): object is TextSnapshot => object.id === id && isTextSnapshot(object),
  );
}

describe('text.model — createText', () => {
  it('TC-01: creates a size M, auto-width text at the clicked top-left, on top', () => {
    const doc = new Y.Doc();
    const sticky = createSticky(doc, { x: 400, y: 300 });
    const stickyZ = objectSnapshots(doc).find((object) => object.id === sticky)!.z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();
    const object = textOf(doc, id!);
    expect(object).toBeDefined();
    expect(object!.type).toBe('text');
    expect(object!.x).toBe(100);
    expect(object!.y).toBe(50);
    expect(object!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(object!.size).toBe('M');
    expect(object!.widthMode).toBe('auto');
    expect(object!.text).toBe('');
    expect(getTextContent(doc, id!)?.toString()).toBe('');
    // On top of everything that was already there.
    expect(object!.z).toBeGreaterThan(stickyZ);
    // A box exists before anything has been measured, so bounds are well-defined.
    expect(object!.width!).toBeGreaterThan(0);
    expect(object!.height!).toBeGreaterThan(0);
    // Who made it, for presence and export.
    expect(entryOf(doc, id!).get('createdBy')).toBe('g_test');
    expect(typeof entryOf(doc, id!).get('createdAt')).toBe('number');
  });

  it('TC-01b: the creation is one local transaction', () => {
    const doc = new Y.Doc();
    let origin: unknown = 'nothing';
    doc.on('update', (_update, transactionOrigin) => {
      origin = transactionOrigin;
    });
    createText(doc, { x: 0, y: 0 }, 'g_test');
    expect(origin).toBe(LOCAL_ORIGIN);
  });

  it('TC-06: a non-finite point creates nothing and emits no update', () => {
    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    for (const point of [
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 10 },
    ]) {
      const { result, updates } = withUpdateCount(doc, () => createText(doc, point, 'g_test'));
      expect(result).toBeNull();
      expect(updates).toBe(0);
    }
    expect(objectSnapshots(doc)).toHaveLength(1);
  });
});

describe('text.model — setTextSize', () => {
  it('TC-02: applies a known size and keeps the position', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 120, y: 80 }, 'g_test')!;
    const before = textOf(doc, id)!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const after = textOf(doc, id)!;
    expect(after.size).toBe('XL');
    expect(TEXT_SIZES[after.size]).toBe(56);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  // The four presets, one row each: a size is stored by key, and the key decides
  // the font size on screen (design TC-02).
  it.each([
    { size: 'S' as const, fontPx: 14 },
    { size: 'M' as const, fontPx: 20 },
    { size: 'L' as const, fontPx: 32 },
    { size: 'XL' as const, fontPx: 56 },
  ])('TC-02c: size $size is stored and draws at $fontPx', ({ size, fontPx }) => {
    const doc = new Y.Doc();
    // Straight from creation, because a heading is often typed at its size.
    const created = createText(doc, { x: 10, y: 20 }, 'g_test', size)!;
    expect(textOf(doc, created)!.size).toBe(size);
    expect(TEXT_SIZES[size]).toBe(fontPx);
    // ...and by changing the size of text that is already there. (Away first: a
    // setter that would write nothing reports false, and size M is what creation
    // already gave it.)
    const id = createText(doc, { x: 10, y: 20 }, 'g_test')!;
    const other = size === 'S' ? 'L' : 'S';
    expect(setTextSize(doc, id, other)).toBe(true);
    expect(setTextSize(doc, id, size)).toBe(true);
    expect(textOf(doc, id)!.size).toBe(size);
  });

  it('TC-02b: an unknown size key is rejected without a transaction', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const { result, updates } = withUpdateCount(doc, () => setTextSize(doc, id, 'XXL'));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(textOf(doc, id)!.size).toBe(DEFAULT_TEXT_SIZE);
  });

  it('a stale id is rejected by every setter, without an update', () => {
    const doc = new Y.Doc();
    const gone = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    objectsMap(doc).delete(gone);

    const { result, updates } = withUpdateCount(doc, () => [
      setTextSize(doc, gone, 'L'),
      setTextWidthFixed(doc, gone, 200),
      setTextBox(doc, gone, { width: 200, height: 40 }),
      deleteIfEmpty(doc, gone),
      isEmptyText(doc, gone),
      getTextContent(doc, gone),
    ]);
    expect(result).toEqual([false, false, false, false, false, undefined]);
    expect(updates).toBe(0);
  });

  it('a sticky note is not a text object', () => {
    const doc = new Y.Doc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(setTextSize(doc, sticky, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, sticky, 200)).toBe(false);
    expect(getTextContent(doc, sticky)).toBeUndefined();
    expect(isEmptyText(doc, sticky)).toBe(false);
  });
});

describe('text.model — setTextWidthFixed', () => {
  it('TC-03: a width below the minimum is clamped to it, and the mode becomes fixed', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const object = textOf(doc, id)!;
    expect(object.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(object.widthMode).toBe('fixed');
  });

  it('TC-03b: exactly the minimum is allowed; a wider width is kept', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(textOf(doc, id)!.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(setTextWidthFixed(doc, id, 321)).toBe(true);
    expect(textOf(doc, id)!.width).toBe(321);
  });

  it('TC-03c: a non-finite width is rejected without a transaction', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textOf(doc, id)!;
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { result, updates } = withUpdateCount(doc, () => setTextWidthFixed(doc, id, width));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(textOf(doc, id)!.width).toBe(before.width);
  });
});

describe('text.model — setTextBox', () => {
  it('writes an impossible box never', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textOf(doc, id)!;
    for (const box of [
      { width: Number.NaN, height: 20 },
      { width: 100, height: Number.NaN },
      { width: 0, height: 20 },
      { width: 100, height: -1 },
    ]) {
      const { result, updates } = withUpdateCount(doc, () => setTextBox(doc, id, box));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(textOf(doc, id)!.width).toBe(before.width);
  });

  it('writes nothing when the box is already what was asked for', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textOf(doc, id)!;
    const { result, updates } = withUpdateCount(doc, () =>
      setTextBox(doc, id, { width: before.width!, height: before.height! }),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('text.model — empty text', () => {
  it('TC-04: zero characters is empty, and deleteIfEmpty removes it', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(0);
  });

  it('TC-04b: whitespace-only text is kept', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, '  ');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(objectSnapshots(doc)).toHaveLength(1);
    expect(textOf(doc, id)!.text).toBe('  ');
  });

  it('deleteIfEmpty on a non-empty object writes nothing', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, 'Went well');
    const { result, updates } = withUpdateCount(doc, () => deleteIfEmpty(doc, id));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('text.model — shared text editing', () => {
  it('TC-05: clampToLimit keeps at most TEXT_MAX_CHARS', () => {
    const tooLong = 'x'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(tooLong, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS - 1), TEXT_MAX_CHARS)).toHaveLength(
      TEXT_MAX_CHARS - 1,
    );
    // 4,999 + 1 is accepted; the 5,001st character is dropped.
    const almost = 'y'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${almost}z`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(`${almost}zz`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-05b: applyTextDiff writes into the shared Y.Text with the given origin', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    let origin: unknown = 'nothing';
    doc.on('update', (_update, transactionOrigin) => {
      origin = transactionOrigin;
    });
    applyTextDiff(ytext, 'Went well', LOCAL_ORIGIN);
    expect(origin).toBe(LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Went well');
    expect(textOf(doc, id)!.text).toBe('Went well');
  });

  it('applyTextDiff is a minimal edit, so a colleague can type alongside', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Went well');
    let ops: unknown[] = [];
    const observer = (event: Y.YTextEvent) => {
      ops = (event.delta as unknown[]).slice();
    };
    ytext.observe(observer);
    applyTextDiff(ytext, 'Went well!', LOCAL_ORIGIN);
    ytext.unobserve(observer);
    expect(ops).toEqual([{ retain: 9 }, { insert: '!' }]);
  });
});
