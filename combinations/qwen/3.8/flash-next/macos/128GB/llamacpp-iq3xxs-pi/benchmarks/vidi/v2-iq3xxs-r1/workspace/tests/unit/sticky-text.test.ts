import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitTextFontSize,
  STICKY_TEXT_BOX_WORLD,
  type MeasureFont,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  applyTextDiff as applyTextDiffFromModel,
  clampToLimit as clampToLimitFromModel,
  counterVisible as counterVisibleFromModel,
  createSticky,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import {
  PROSE_1000,
  PROSE_1200,
  RETRO_ITEM,
  SHORT_PHRASE,
  proseOfLength,
} from '../fixtures/texts';

type TextOp = { retain?: number; insert?: string; delete?: number };

interface Harness {
  doc: Y.Doc;
  ytext: Y.Text;
  /** Y.Text delta events recorded after this harness was created. */
  deltas: Op[][];
  updates(): number;
}
type Op = TextOp;

function harness(initial = ''): Harness {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  const ytext = getStickyText(doc, id)!;
  expect(ytext).toBeInstanceOf(Y.Text);
  if (initial) ytext.insert(0, initial);
  const deltas: Op[][] = [];
  ytext.observe((event) => deltas.push(event.delta as Op[]));
  let updates = 0;
  doc.on('update', () => updates++);
  return { doc, ytext, deltas, updates: () => updates };
}

const inserts = (ops: Op[]): string[] => ops.filter((o) => o.insert !== undefined).map((o) => o.insert!);
const deletes = (ops: Op[]): number[] => ops.filter((o) => o.delete !== undefined).map((o) => o.delete!);

describe('sticky.text (src/client/objects/StickyText.ts)', () => {
  it('fixtures are prose of the promised lengths', () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    expect(PROSE_1000).toHaveLength(1000);
    expect(PROSE_1200).toHaveLength(1200);
    expect(PROSE_1200.startsWith(PROSE_1000)).toBe(true);
    expect(new Set(PROSE_1000).size).toBeGreaterThan(25); // real text, not 'aaaa…'
    expect(PROSE_1000).toContain(' ');
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
  });

  // TC-13: an insertion in the middle is a single insert, never delete-all + insert-all.
  it('TC-13 applyTextDiff("abc" -> "abXc") is a single insert of "X" at index 2', () => {
    const h = harness('abc');
    applyTextDiff(h.ytext, 'abXc', null);
    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(h.ytext.toString()).toBe('abXc');
    expect(deletes(h.deltas[0]!)).toEqual([]);
  });

  it('applyTextDiff with a deletion in the middle is a single delete of one char', () => {
    const h = harness('abcdef');
    applyTextDiff(h.ytext, 'abcef', null);
    expect(h.deltas).toHaveLength(1);
    expect(inserts(h.deltas[0]!)).toEqual([]);
    expect(deletes(h.deltas[0]!)).toEqual([1]);
    expect(h.ytext.toString()).toBe('abcef');
  });

  it('applyTextDiff replacing a selection is one delete plus one insert', () => {
    const h = harness('abc');
    applyTextDiff(h.ytext, 'aXc', null);
    expect(h.deltas).toHaveLength(1);
    expect(deletes(h.deltas[0]!)).toEqual([1]);
    expect(inserts(h.deltas[0]!)).toEqual(['X']);
    expect(h.ytext.toString()).toBe('aXc');
  });

  it('applyTextDiff with no change performs no transaction and emits no event', () => {
    const h = harness(SHORT_PHRASE);
    applyTextDiff(h.ytext, SHORT_PHRASE, null);
    expect(h.deltas).toHaveLength(0);
    expect(h.updates()).toBe(0);
  });

  it('applyTextDiff keeps emoji surrogate pairs intact', () => {
    const cases: [string, string][] = [
      ['a😀b', 'a😀c'], // replace the char after a pair
      ['a😀b', 'ab'], // delete a whole pair
      ['', '😀x'], // insert a pair at the start
      ['😀', '🎉'], // replace one pair with another
      ['hello 😀', 'hello 😀😀'], // duplicate a pair
    ];
    for (const [before, after] of cases) {
      const h = harness(before);
      applyTextDiff(h.ytext, after, null);
      const text = h.ytext.toString();
      expect(text).toBe(after);
      expect(text).not.toContain('\uFFFD'); // no lone surrogate turned into a replacement char
      expect(Array.from(text).length).toBe(Array.from(after).length); // code points intact
      expect(h.deltas.length).toBeLessThanOrEqual(2); // never delete-all + insert-all
    }
  });

  it('applyTextDiff writes one transaction per edit', () => {
    const h = harness('');
    const before = h.updates();
    applyTextDiff(h.ytext, RETRO_ITEM, null);
    expect(h.updates()).toBe(before + 1);
    expect(h.ytext.toString()).toBe(RETRO_ITEM);
  });

  // TC-14: a 1,200 character paste keeps exactly the first 1,000 characters.
  it('TC-14 clampToLimit cuts a 1,200 character paste at 1,000', () => {
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);
  });

  it('clampToLimit leaves anything at or below the limit untouched', () => {
    for (const n of [0, 1, 999, 1000]) {
      const text = proseOfLength(n);
      expect(clampToLimit(text)).toBe(text);
    }
    expect(clampToLimit('abc')).toBe('abc');
  });

  // TC-15: 999 + 1 character is accepted (boundary).
  it('TC-15 accepts one more character at 999 characters', () => {
    const h = harness(proseOfLength(STICKY_TEXT_MAX_CHARS - 1));
    applyTextDiff(h.ytext, PROSE_1000, null);
    expect(h.ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(h.ytext.toString()).toBe(PROSE_1000);
  });

  // TC-16 (negative/boundary): 1,000 + 1 character never grows the text.
  it('TC-16 rejects one more character at exactly 1,000 characters', () => {
    const h = harness(PROSE_1000);
    const clamped = clampToLimit(`${PROSE_1000}x`);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);
    const before = h.updates();
    applyTextDiff(h.ytext, clamped, null);
    expect(h.ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(h.updates()).toBe(before);
  });

  // TC-17: counter visibility at the STICKY_COUNTER_THRESHOLD_CHARS boundary.
  it('TC-17 counterVisible flips at 949 / 950 / 951 characters', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(948)).toBe(false);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('the configured font size range is the documented 24..10', () => {
    expect(STICKY_FONT_MAX_PX).toBe(24);
    expect(STICKY_FONT_MIN_PX).toBe(10);
    expect(STICKY_FONT_MIN_PX).toBeLessThan(STICKY_FONT_MAX_PX);
  });

  it('re-exports the text helpers from the board model surface', () => {
    expect(applyTextDiffFromModel).toBe(applyTextDiff);
    expect(clampToLimitFromModel).toBe(clampToLimit);
    expect(counterVisibleFromModel).toBe(counterVisible);
  });
});

/**
 * A fake layout for the font fit: one character is half an em wide, text wraps at the
 * box width and the line box is 1.35 x the font size. Real layout is exercised
 * in the browser (see the E2E long-text case); jsdom has no layout at all.
 */
function wrapMeasure(text: string, boxPx = STICKY_TEXT_BOX_WORLD): MeasureFont {
  return (fontPx: number) => {
    const charsPerLine = Math.max(1, Math.floor(boxPx / (fontPx / 2)));
    const lines = text
      .split('\n')
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
    return lines * fontPx * 1.35;
  };
}

describe('font fit (the fit behind TC-33)', () => {
  it('TC-16 keeps the maximum size when a short phrase fits at it', () => {
    expect(STICKY_TEXT_BOX_WORLD).toBe(168);
    const fit = fitTextFontSize(SHORT_PHRASE, wrapMeasure(SHORT_PHRASE));
    expect(fit.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(fit.overflow).toBe(false);
  });

  it('TC-16 goes to the minimum size and reports overflow for 1,000 characters', () => {
    const fit = fitTextFontSize(PROSE_1000, wrapMeasure(PROSE_1000));
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
  });

  it('TC-16 picks the largest size that still fits for text in between', () => {
    const text = proseOfLength(200);
    const measure = wrapMeasure(text);
    const fit = fitTextFontSize(text, measure);
    expect(fit.overflow).toBe(false);
    expect(fit.fontPx).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(fit.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    // the largest fitting size, not merely a fitting size
    expect(measure(fit.fontPx)).toBeLessThanOrEqual(STICKY_TEXT_BOX_WORLD);
    expect(measure(fit.fontPx + 1)).toBeGreaterThan(STICKY_TEXT_BOX_WORLD);
  });

  it('TC-16 is independent of zoom: scaling text and box together keeps the size', () => {
    const text = proseOfLength(200);
    const at100 = fitTextFontSize(text, wrapMeasure(text), STICKY_TEXT_BOX_WORLD);
    // zooming scales the measured height and the box by the same factor, so the
    // chosen size must not change (and never needs to be recomputed)
    const at200 = fitTextFontSize(
      text,
      (fontPx) => wrapMeasure(text)(fontPx) * 2,
      STICKY_TEXT_BOX_WORLD * 2,
    );
    expect(at200).toEqual(at100);
  });

  it('an empty note keeps the maximum size and never overflows', () => {
    expect(fitTextFontSize('', wrapMeasure(''))).toEqual({
      fontPx: STICKY_FONT_MAX_PX,
      overflow: false,
    });
    expect(fitTextFontSize('   \n  ', wrapMeasure('   \n  '))).toEqual({
      fontPx: STICKY_FONT_MAX_PX,
      overflow: false,
    });
  });
});
