import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampAtCaret, clampToLimit, counterVisible, fitFontSize } from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_PARAGRAPH, proseOfLength, SHORT_PHRASE } from '../fixtures/texts';

const ORIGIN = Symbol('test');
const PASTE_LENGTH = 1200;

type Delta = { insert?: unknown; delete?: number; retain?: number }[];

/** A Y.Text holding `initial`, plus a recorder of the deltas of later changes. */
function textWith(initial: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  const deltas: Delta[] = [];
  const origins: unknown[] = [];
  let transactions = 0;
  ytext.observe((e) => {
    deltas.push(e.delta as Delta);
    origins.push(e.transaction.origin);
  });
  // 'update' fires once per transaction that changed the document.
  doc.on('update', () => {
    transactions += 1;
  });
  return { ytext, deltas, origins, transactions: () => transactions };
}

describe('sticky.text applyTextDiff', () => {
  it("TC-13 'abc' → 'abXc' is a single insert of 'X' at index 2", () => {
    const t = textWith('abc');
    applyTextDiff(t.ytext, 'abXc', ORIGIN);
    expect(t.ytext.toString()).toBe('abXc');
    expect(t.deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(t.origins).toEqual([ORIGIN]);
    expect(t.transactions()).toBe(1);
  });

  it('pure deletion in the middle is a single delete', () => {
    const t = textWith(SHORT_PHRASE); // 'Faster onboarding'
    applyTextDiff(t.ytext, 'Faster boarding', ORIGIN);
    expect(t.ytext.toString()).toBe('Faster boarding');
    expect(t.deltas).toEqual([[{ retain: 7 }, { delete: 2 }]]);
  });

  it('replacing a selection is one delete and one insert in one transaction', () => {
    const t = textWith('Faster onboarding');
    applyTextDiff(t.ytext, 'Smoother onboarding', ORIGIN);
    expect(t.ytext.toString()).toBe('Smoother onboarding');
    expect(t.transactions()).toBe(1);
    expect(t.deltas).toHaveLength(1);
    const ops = t.deltas[0]!;
    expect(ops.filter((o) => o.insert !== undefined)).toHaveLength(1);
    expect(ops.filter((o) => o.delete !== undefined)).toHaveLength(1);
  });

  it('no change emits nothing', () => {
    const t = textWith('same');
    applyTextDiff(t.ytext, 'same', ORIGIN);
    expect(t.deltas).toHaveLength(0);
    expect(t.transactions()).toBe(0);
  });

  it('emoji surrogate pairs are kept intact when an emoji is replaced by another sharing a surrogate half', () => {
    // 😀 = 😀, 😃 = 😃: same high surrogate.
    const t = textWith('Ship it 😀!');
    applyTextDiff(t.ytext, 'Ship it 😃!', ORIGIN);
    expect(t.ytext.toString()).toBe('Ship it 😃!');
    const ops = t.deltas[0]!;
    const inserted = ops.find((o) => o.insert !== undefined)?.insert;
    expect(inserted).toBe('😃');
    expect(ops.find((o) => o.delete !== undefined)?.delete).toBe(2);
  });

  it('emoji inserted before an emoji with a shared low surrogate is not split', () => {
    // 🙂 = 🙂, 😂 = 😂 — suffix search must not split pairs.
    const t = textWith('a😂');
    applyTextDiff(t.ytext, 'a🙂😂', ORIGIN);
    expect(t.ytext.toString()).toBe('a🙂😂');
    const inserted = t.deltas[0]!.find((o) => o.insert !== undefined)?.insert as string;
    expect(inserted).toBe('🙂');
  });

  it('works on multi-line text', () => {
    const t = textWith('line one\nline three');
    applyTextDiff(t.ytext, 'line one\nline two\nline three', ORIGIN);
    expect(t.ytext.toString()).toBe('line one\nline two\nline three');
    // Common prefix wins, so the 9 inserted characters start after 'line one\nline t'.
    expect(t.deltas).toEqual([[{ retain: 15 }, { insert: 'wo\nline t' }]]);
  });
});

describe('sticky.text clampToLimit', () => {
  it(`TC-14 pasting ${PASTE_LENGTH} characters into an empty note keeps ${STICKY_TEXT_MAX_CHARS}`, () => {
    const pasted = proseOfLength(PASTE_LENGTH);
    const kept = clampToLimit(pasted);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 999 + 1 characters → 1,000 accepted', () => {
    const next = proseOfLength(STICKY_TEXT_MAX_CHARS - 1) + 'x';
    expect(clampToLimit(next)).toBe(next);
    expect(clampToLimit(next)).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 1,000 + 1 characters → the extra character is rejected', () => {
    const next = LONG_PARAGRAPH + 'x';
    expect(clampToLimit(next)).toBe(LONG_PARAGRAPH);
  });

  it('short text and a custom max', () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(SHORT_PHRASE, 6)).toBe('Faster');
    expect(clampToLimit('')).toBe('');
  });

  it('does not leave half an emoji at the limit', () => {
    const next = 'abc😀';
    expect(clampToLimit(next, 4)).toBe('abc');
  });
});

describe('sticky.text clampAtCaret', () => {
  it('pasting at the end behaves like clampToLimit, caret at the end of the kept text', () => {
    const pasted = proseOfLength(PASTE_LENGTH);
    expect(clampAtCaret(pasted, pasted.length)).toEqual({
      text: pasted.slice(0, STICKY_TEXT_MAX_CHARS),
      caret: STICKY_TEXT_MAX_CHARS,
    });
  });

  it('pasting in the middle drops the tail of the pasted text, not the text after the caret', () => {
    const before = 'Faster ';
    const after = 'onboarding';
    const pasted = 'and much smoother ';
    const max = before.length + after.length + 4;
    const next = before + pasted + after;
    expect(clampAtCaret(next, before.length + pasted.length, max)).toEqual({
      text: 'Faster and onboarding',
      caret: before.length + 4,
    });
  });

  it('typing one character at the limit in the middle is rejected', () => {
    const next = 'abXc';
    expect(clampAtCaret(next, 3, 3)).toEqual({ text: 'abc', caret: 2 });
  });

  it('under the limit nothing changes', () => {
    expect(clampAtCaret(SHORT_PHRASE, 3)).toEqual({ text: SHORT_PHRASE, caret: 3 });
  });
});

describe('sticky.text counterVisible', () => {
  it('TC-17 949 / 950 / 951 characters → false / true / true', () => {
    const edge = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    expect(counterVisible(edge - 1)).toBe(false);
    expect(counterVisible(edge)).toBe(true);
    expect(counterVisible(edge + 1)).toBe(true);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});

describe('sticky.text fitFontSize (layout simulated; real layout is covered by e2e TC-33)', () => {
  const BOX = 168;
  /** Fake element whose content height grows with the square of the font size. */
  function fakeEl(heightPerPxSquared: number) {
    const el = { style: { fontSize: '' } } as unknown as HTMLElement;
    Object.defineProperty(el, 'scrollHeight', {
      get: () => parseFloat(el.style.fontSize) ** 2 * heightPerPxSquared,
    });
    return el;
  }

  it('short text gets the maximum size', () => {
    const el = fakeEl(0.1);
    expect(fitFontSize(el, BOX)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);
  });

  it('picks the largest integer size that fits', () => {
    // 16px → 256 * 0.65 = 166.4 fits; 17px → 187.85 does not.
    const el = fakeEl(0.65);
    expect(fitFontSize(el, BOX)).toEqual({ fontPx: 16, overflow: false });
    expect(el.style.fontSize).toBe('16px');
  });

  it('text that does not fit at the minimum size overflows at the minimum', () => {
    const el = fakeEl(10);
    expect(fitFontSize(el, BOX)).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MIN_PX}px`);
  });
});
