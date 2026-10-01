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
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  initDoc,
  createSticky,
  deleteObjects,
  snapshot,
} from '../../src/shared/board-model';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * Story 9 (text.model): the text object model against a real Y.Doc.
 * Schema rules, validation and error paths (unknown size, stale id,
 * non-finite numbers) — no transactions on rejection.
 */

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Count `update` events emitted by `fn` on the doc. */
function withUpdateCount(doc: Y.Doc, fn: () => unknown): { result: unknown; updates: number } {
  let updates = 0;
  const handler = () => {
    updates += 1;
  };
  doc.on('update', handler);
  let result: unknown;
  try {
    result = fn();
  } finally {
    doc.off('update', handler);
  }
  return { result, updates };
}

function objMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = doc.getMap('objects').get(id);
  expect(m, `object ${id} should exist`).toBeInstanceOf(Y.Map);
  return m as Y.Map<unknown>;
}

describe('story 9: text object model (unit)', () => {
  // TC-01
  it('TC-01: createText → type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    const doc = makeDoc();
    // Existing objects so z ordering is observable.
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 0, y: 0 });

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(typeof id).toBe('string');

    const m = objMap(doc, id!);
    expect(m.get('type')).toBe('text');
    expect(m.get('x')).toBe(100); // top-left at the clicked point
    expect(m.get('y')).toBe(50);
    expect(m.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(m.get('widthMode')).toBe('auto');
    expect(m.get('createdBy')).toBe('g_test');
    const text = m.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');

    // z above every existing object.
    const all = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const zValues = [...all.values()].map((o) => o.get('z'));
    expect(m.get('z')).toBe(Math.max(...(zValues as number[])));

    // A finite initial box exists so bounds are defined before first measure.
    const w = m.get('width');
    const h = m.get('height');
    expect(typeof w).toBe('number');
    expect(typeof h).toBe('number');
    expect(Number.isFinite(w as number)).toBe(true);
    expect(Number.isFinite(h as number)).toBe(true);
  });

  // TC-02
  it('TC-02: setTextSize XL applies; unknown size "XXL" → false and no update (error path)', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    const { result: ok, updates: u1 } = withUpdateCount(doc, () => setTextSize(doc, id, 'XL'));
    expect(ok).toBe(true);
    expect(u1).toBe(1);
    expect(objMap(doc, id).get('size')).toBe('XL');

    const { result: bad, updates: u2 } = withUpdateCount(doc, () => setTextSize(doc, id, 'XXL'));
    expect(bad).toBe(false);
    expect(u2).toBe(0);
    expect(objMap(doc, id).get('size')).toBe('XL'); // unchanged

    // All four presets are accepted.
    for (const s of Object.keys(TEXT_SIZES)) {
      expect(setSizeReturnsTrue(doc, id, s)).toBe(true);
    }
  });

  function setSizeReturnsTrue(doc: Y.Doc, id: string, s: string): boolean {
    return setTextSize(doc, id, s);
  }

  // TC-03
  it('TC-03: setTextWidthFixed(30) → clamped to TEXT_MIN_WIDTH_WORLD, widthMode fixed (boundary)', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    const { result } = withUpdateCount(doc, () => setTextWidthFixed(doc, id, 30));
    expect(result).toBe(true);
    const m = objMap(doc, id);
    expect(m.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(m.get('widthMode')).toBe('fixed');

    // Exactly the minimum is accepted unchanged.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(objMap(doc, id).get('width')).toBe(TEXT_MIN_WIDTH_WORLD);

    // A larger width is kept.
    expect(setTextWidthFixed(doc, id, 300)).toBe(true);
    expect(objMap(doc, id).get('width')).toBe(300);
  });

  // TC-04
  it('TC-04: isEmptyText true for zero characters → deleteIfEmpty removes; whitespace-only kept', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').get(id)).toBeUndefined();

    // Whitespace-only is NOT empty (decision: only zero characters counts).
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const t2 = getTextContent(doc, id2)!;
    t2.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').get(id2)).toBeDefined();

    // Non-empty text is kept.
    t2.insert(0, 'x');
    expect(deleteIfEmpty(doc, id2)).toBe(false);
  });

  // TC-05
  it('TC-05: clampToLimit at TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries)', () => {
    const at = 'a'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(at, TEXT_MAX_CHARS)).toBe(at);
    expect(clampToLimit(at + 'b', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(at + 'b', TEXT_MAX_CHARS)).toBe(at);
    const under = 'b'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(under + 'c', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  // TC-06
  it('TC-06: non-finite create point → null, no transaction (error path)', () => {
    const doc = makeDoc();
    const { result, updates } = withUpdateCount(doc, () =>
      createText(doc, { x: NaN, y: 50 }, 'g_test'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);

    const { result: r2, updates: u2 } = withUpdateCount(doc, () =>
      createText(doc, { x: 100, y: Infinity }, 'g_test'),
    );
    expect(r2).toBeNull();
    expect(u2).toBe(0);
  });

  describe('stale ids and validation', () => {
    it('every setter returns false for a stale id without a transaction', () => {
      const doc = makeDoc();
      const missing = 'no-such-id';

      const cases: Array<[name: string, fn: () => boolean]> = [
        ['setTextSize', () => setTextSize(doc, missing, 'XL')],
        ['setTextWidthFixed', () => setTextWidthFixed(doc, missing, 100)],
        ['setTextBox', () => setTextBox(doc, missing, { width: 10, height: 10 })],
        ['deleteIfEmpty', () => deleteIfEmpty(doc, missing)],
      ];
      for (const [name, fn] of cases) {
        const { result, updates } = withUpdateCount(doc, fn);
        expect(result, name).toBe(false);
        expect(updates, name).toBe(0);
      }
      expect(getTextContent(doc, missing)).toBeUndefined();
      expect(isEmptyText(doc, missing)).toBe(false);
    });

    it('setTextBox rejects non-finite dimensions', () => {
      const doc = makeDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const { result, updates } = withUpdateCount(doc, () =>
        setTextBox(doc, id, { width: NaN, height: 10 }),
      );
      expect(result).toBe(false);
      expect(updates).toBe(0);

      expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);
      const m = objMap(doc, id);
      expect(m.get('width')).toBe(120);
      expect(m.get('height')).toBe(52);
    });

    it('setTextWidthFixed rejects non-finite widths', () => {
      const doc = makeDoc();
      const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
      const { result, updates } = withUpdateCount(doc, () =>
        setTextWidthFixed(doc, id, Infinity),
      );
      expect(result).toBe(false);
      expect(updates).toBe(0);
    });
  });

  describe('integration with the generic model (text.consistent)', () => {
    it('text objects flow through objects(), deleteObjects and snapshots', () => {
      const doc = makeDoc();
      const sticky = createSticky(doc, { x: 0, y: 0 })!;
      const text = createText(doc, { x: 100, y: 100 }, 'g_test')!;
      getTextContent(doc, text)!.insert(0, 'Went well');

    const textSnap = doc.getMap('objects').get(text) as Y.Map<unknown>;
      expect(textSnap.get('type')).toBe('text');

      // deleteObjects removes it in one transaction (story 7 generic path).
      expect(deleteObjects(doc, [text])).toBe(1);
      expect(doc.getMap('objects').get(text)).toBeUndefined();
      // The sticky snapshot contract is unchanged.
      expect(snapshot(doc)).toHaveLength(1);
      expect(snapshot(doc)[0].id).toBe(sticky);
      void textSnap;
    });
  });
});

// The initial box height matches one line at the default size (layout contract).
describe('initial box sanity', () => {
  it('createText initial box: width >= 0 finite, height = one line at M', () => {
    const doc = makeDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const m = objMap(doc, id);
    const h = m.get('height') as number;
    expect(h).toBeCloseTo(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT, 6);
  });
});
