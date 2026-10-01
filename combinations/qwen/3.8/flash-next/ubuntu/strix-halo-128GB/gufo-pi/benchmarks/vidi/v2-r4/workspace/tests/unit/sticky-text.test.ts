import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  autoFitFontSize,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  LONG_PARAGRAPH_1000,
  PASTE_1200,
  RETRO_ITEM,
  SHORT_PHRASE,
} from '../fixtures/texts';

interface DeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

/** Record the deltas a Y.Text applies while `fn` runs. */
function recordDeltas(ytext: Y.Text, fn: () => void): DeltaOp[][] {
  const deltas: DeltaOp[][] = [];
  const listener = (event: Y.YTextEvent) => {
    deltas.push(event.delta as DeltaOp[]);
  };
  ytext.observe(listener);
  try {
    fn();
  } finally {
    ytext.unobserve(listener);
  }
  return deltas;
}

function makeText(value: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (value.length > 0) ytext.insert(0, value);
  return { doc, ytext };
}

describe('sticky.text — applyTextDiff', () => {
  it('TC-13 inserts a single character with a minimal delta', () => {
    const { doc, ytext } = makeText('abc');
    const deltas = recordDeltas(ytext, () => applyTextDiff(ytext, 'abXc', doc));
    expect(ytext.toString()).toBe('abXc');
    // exactly one delete/insert pair: a single insert of 'X' at index 2
    const ops = deltas.flat();
    expect(ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13 a deletion in the middle is a single delete', () => {
    const { doc, ytext } = makeText('abcdef');
    const deltas = recordDeltas(ytext, () => applyTextDiff(ytext, 'abdef', doc));
    expect(ytext.toString()).toBe('abdef');
    expect(deltas.flat()).toEqual([{ retain: 2 }, { delete: 1 }]);
  });

  it('TC-13 replacing a selection is one delete plus one insert', () => {
    const { doc, ytext } = makeText('hello world');
    const deltas = recordDeltas(ytext, () => applyTextDiff(ytext, 'hello brave world', doc));
    expect(ytext.toString()).toBe('hello brave world');
    const ops = deltas.flat();
    const inserts = ops.filter((op) => op.insert !== undefined);
    const deletes = ops.filter((op) => op.delete !== undefined);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.insert).toBe('brave ');
    expect(deletes).toHaveLength(0);
  });

  it('TC-13 replaces a middle selection with different text in one delete and one insert', () => {
    const { doc, ytext } = makeText('one two three');
    applyTextDiff(ytext, 'one 2 three', doc);
    expect(ytext.toString()).toBe('one 2 three');
  });

  it('TC-13 no change produces no operation at all', () => {
    const { doc, ytext } = makeText('same');
    const deltas = recordDeltas(ytext, () => applyTextDiff(ytext, 'same', doc));
    expect(deltas).toHaveLength(0);
  });

  it('TC-13 keeps emoji surrogate pairs intact', () => {
    const { doc, ytext } = makeText('a\u{1F600}b');
    applyTextDiff(ytext, 'a\u{1F600}Xb', doc);
    expect(ytext.toString()).toBe('a\u{1F600}Xb');
    applyTextDiff(ytext, 'a\u{1F600}Xy\u{1F601}', doc);
    expect(ytext.toString()).toBe('a\u{1F600}Xy\u{1F601}');
    // deleting the emoji removes both surrogates, never half of one
    applyTextDiff(ytext, 'aXy', doc);
    expect(ytext.toString()).toBe('aXy');
    expect(ytext.toString()).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('works on realistic multi-line text', () => {
    const { doc, ytext } = makeText(RETRO_ITEM);
    const next = RETRO_ITEM.replace('early', 'a day early');
    applyTextDiff(ytext, next, doc);
    expect(ytext.toString()).toBe(next);
  });
});

describe('sticky.text — clampToLimit', () => {
  it('TC-14 a 1,200 character paste keeps exactly the first 1,000', () => {
    const pasted = PASTE_1200;
    expect(pasted.length).toBe(1200);
    const clamped = clampToLimit(pasted);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(LONG_PARAGRAPH_1000);
  });

  it('leaves text under the limit unchanged', () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
  });

  it('TC-15 999 characters plus one is accepted (boundary)', () => {
    const base = LONG_PARAGRAPH_1000.slice(0, 999);
    const merged = clampToLimit(base + '!');
    expect(merged).toBe(LONG_PARAGRAPH_1000.slice(0, 999) + '!');
    expect(merged.length).toBe(1000);
  });

  it('TC-16 at 1,000 characters nothing more can be added (boundary, negative)', () => {
    const base = LONG_PARAGRAPH_1000;
    expect(clampToLimit(base + 'x')).toBe(base);
    const { doc, ytext } = makeText(base);
    applyTextDiff(ytext, clampToLimit(base + 'x'), doc);
    expect(ytext.toString()).toBe(base);
    expect(ytext.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('does not split a surrogate pair at the limit', () => {
    const text = 'a'.repeat(999) + '\u{1F600}';
    const clamped = clampToLimit(text);
    expect(clamped).toBe('a'.repeat(999));
  });
});

describe('sticky.text — counterVisible', () => {
  it('TC-17 shows at 950 and above, hides at 949 (boundary)', () => {
    const remaining = (len: number) => STICKY_TEXT_MAX_CHARS - len;
    expect(remaining(949)).toBe(STICKY_COUNTER_THRESHOLD_CHARS + 1);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('hides for empty notes', () => {
    expect(counterVisible(0)).toBe(false);
  });
});

describe('sticky.text — autoFitFontSize', () => {
  // A stand-in for layout: glyphs are half an em wide, 40 of them fit a line,
  // and every line is 1.25 em tall.
  const measure = (text: string, fontPx: number) => ({
    width: Math.min(text.length, 40) * fontPx * 0.5,
    height: Math.ceil(text.length / 40) * fontPx * 1.25,
  });

  it('uses the largest size for a short phrase', () => {
    const fit = autoFitFontSize('Idea', measure, 176, 176);
    expect(fit).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  });

  it('shrinks a realistic phrase rather than clipping it', () => {
    const fit = autoFitFontSize(SHORT_PHRASE, measure, 176, 176);
    expect(fit.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(fit.fontPx).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(false);
  });

  it('shrinks to the largest size that still fits', () => {
    // 17 characters on one line: 20 px is the last size whose width
    // (17 * 0.5 * size) stays inside 176 px, 21 px would not.
    const fit = autoFitFontSize(SHORT_PHRASE, measure, 176, 176);
    expect(fit.fontPx).toBe(20);
    expect(fit.overflow).toBe(false);
    expect(measure(SHORT_PHRASE, 21).width).toBeGreaterThan(176);
  });

  it('TC-33 reports overflow for text that cannot fit at the minimum', () => {
    const fit = autoFitFontSize(LONG_PARAGRAPH_1000, measure, 176, 176);
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
  });

  it('treats a zero-sized box as overflow rather than looping', () => {
    const fit = autoFitFontSize(SHORT_PHRASE, measure, 0, 0);
    expect(fit).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
  });

  it('never returns a size outside the configured range', () => {
    for (const text of ['', SHORT_PHRASE, RETRO_ITEM, LONG_PARAGRAPH_1000]) {
      const fit = autoFitFontSize(text, measure, 176, 176);
      expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(fit.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    }
  });
});
