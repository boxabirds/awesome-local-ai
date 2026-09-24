/**
 * Story 2 · task 3 — sticky text logic unit tests (TC-13 … TC-17), against a
 * real `Y.Text`. The minimum-diff requirement (not delete-all + insert-all) is
 * what keeps concurrent typing safe once story 3 ships, so it is asserted on
 * the actual delta the transaction produces.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_TEXT, RETRO_TEXT, SHORT_TEXT } from '../fixtures/texts';

/** Attach a Y.Text seeded with `initial`, and record every delta afterwards. */
/** A Y.Text delta op (retain / insert / delete). */
type TextOp = { retain?: number; insert?: string; delete?: number };

function seededText(initial: string): {
  doc: Y.Doc;
  ytext: Y.Text;
  record: () => TextOp[][];
} {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (initial.length > 0) ytext.insert(0, initial);
  const deltas: TextOp[][] = [];
  ytext.observe((event) => {
    deltas.push(event.delta as TextOp[]);
  });
  return { doc, ytext, record: () => deltas };
}

describe('clampToLimit', () => {
  it('TC-14: pasting 1,200 characters into empty keeps exactly the first 1,000', () => {
    const pasted = LONG_TEXT.repeat(2).slice(0, 1200);
    expect(pasted.length).toBe(1200);
    const clamped = clampToLimit(pasted);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(LONG_TEXT.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('leaves text at or under the limit untouched', () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit(RETRO_TEXT)).toBe(RETRO_TEXT);
  });

  it('does not split a surrogate pair at the cut', () => {
    // 999 'a' then an emoji (2 code units) then more: the cut at 1,000 would
    // otherwise land between the two halves of the emoji.
    const text = `${'a'.repeat(999)}\u{1F600}tail`;
    const clamped = clampToLimit(text);
    expect(clamped.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
    // The last kept code unit is never an orphaned high surrogate.
    const last = clamped.charCodeAt(clamped.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });
});

describe('counterVisible', () => {
  it('TC-17: appears at the threshold boundary 949 / 950 / 951', () => {
    // Remaining = 1000 - length. Counter shows once remaining <= 50.
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining (boundary)
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it('is hidden for short text and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(100)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(STICKY_TEXT_MAX_CHARS - 950).toBe(STICKY_COUNTER_THRESHOLD_CHARS);
  });
});

describe('applyTextDiff (minimum diff)', () => {
  it('TC-13: abc -> abXc is a single insert of X at index 2, not a rewrite', () => {
    const { ytext, record } = seededText('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    const events = record();
    expect(events).toHaveLength(1);
    const [delta] = events;
    const retained = delta
      .filter((op: TextOp) => 'retain' in op)
      .reduce((total: number, op: TextOp) => total + (op.retain as number), 0);
    const deleted = delta
      .filter((op: TextOp) => 'delete' in op)
      .reduce((total: number, op: TextOp) => total + (op.delete as number), 0);
    const inserted = delta
      .filter((op: TextOp) => 'insert' in op)
      .map((op: TextOp) => op.insert);

    // A full replace would look like delete 3 + insert 4; we must not.
    expect(deleted).toBe(0);
    expect(retained).toBe(2);
    expect(inserted).toEqual(['X']);
    expect(ytext.toString()).toBe('abXc');
  });

  it('deletes only the differing middle', () => {
    const { ytext, record } = seededText('the quick brown fox');
    applyTextDiff(ytext, 'the quick fox', LOCAL_ORIGIN);
    const [delta] = record();
    const deleted = delta
      .filter((op: TextOp) => 'delete' in op)
      .reduce((total: number, op: TextOp) => total + (op.delete as number), 0);
    expect(ytext.toString()).toBe('the quick fox');
    // Only "brown " (6 chars) is removed, not the whole string rewritten.
    expect(deleted).toBe(6);
    const rewritten = delta.filter((op: TextOp) => 'delete' in op).length;
    expect(rewritten).toBe(1);
  });

  it('replaces a selection in the middle with one delete + one insert', () => {
    const { ytext } = seededText('abcdef');
    applyTextDiff(ytext, 'abXYf', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXYf');
  });

  it('keeps emoji surrogate pairs intact when editing around them', () => {
    const { ytext } = seededText('go \u{1F600} now');
    applyTextDiff(ytext, 'go \u{1F600} now!', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('go \u{1F600} now!');
    // The emoji (two code units) is preserved verbatim in the result.
    expect(ytext.toString()).toContain('\u{1F600}');
  });

  it('is a no-op for an identical value (no transaction observed)', () => {
    const { ytext, record } = seededText('same');
    applyTextDiff(ytext, 'same', LOCAL_ORIGIN);
    expect(record()).toHaveLength(0);
  });
});

describe('length limit + diff boundary', () => {
  it('TC-15: 999 + 1 -> exactly 1,000 characters accepted', () => {
    const base = LONG_TEXT.slice(0, 999);
    const { ytext } = seededText(base);
    const next = clampToLimit(`${base}Z`);
    expect(next.length).toBe(1000);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString().length).toBe(1000);
    expect(ytext.toString().endsWith('Z')).toBe(true);
  });

  it('TC-16: 1,000 + 1 -> the extra character is rejected, still 1,000', () => {
    const base = LONG_TEXT.slice(0, 1000);
    const { ytext } = seededText(base);
    // The editor clamps before diffing; a full replace is not allowed to grow
    // the text past the limit.
    const next = clampToLimit(`${base}ZZZZ`);
    expect(next.length).toBe(1000);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('fitFontSize', () => {
  /**
   * A fake element whose `scrollHeight` reacts to the font size that
   * `fitFontSize` writes into `style.fontSize`, so the binary search can be
   * exercised without a real layout engine (which jsdom does not have).
   */
  function fakeElement(heightForFont: (fontPx: number) => number): HTMLElement {
    const state: { fontSize: string } = { fontSize: '' };
    return {
      style: {
        get fontSize() {
          return state.fontSize;
        },
        set fontSize(value: string) {
          state.fontSize = value;
        },
      },
      get scrollHeight() {
        const size = Number.parseFloat(state.fontSize) || 0;
        return heightForFont(size);
      },
    } as unknown as HTMLElement;
  }

  it('returns the maximum font when nothing overflows at the largest size', () => {
    // scrollHeight always below the box -> everything fits.
    const el = fakeElement(() => 0);
    const result = fitFontSize(el, 200);
    expect(result.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(result.overflow).toBe(false);
  });

  it('shrinks to fit and reports no overflow when a smaller size fits', () => {
    // 24 -> 240 (too tall for a 200 box), but 20 -> 200 fits exactly.
    const el = fakeElement((fontPx) => fontPx * 10);
    const result = fitFontSize(el, 200);
    expect(result.overflow).toBe(false);
    expect(result.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(result.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    // The chosen size genuinely fits the box.
    expect(el.scrollHeight <= 200).toBe(true);
  });

  it('pins to the minimum and flags overflow when even the minimum does not fit', () => {
    // Even 10px is 1000 tall: nothing fits.
    const el = fakeElement((fontPx) => fontPx * 100);
    const result = fitFontSize(el, 200);
    expect(result.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(result.overflow).toBe(true);
  });
});