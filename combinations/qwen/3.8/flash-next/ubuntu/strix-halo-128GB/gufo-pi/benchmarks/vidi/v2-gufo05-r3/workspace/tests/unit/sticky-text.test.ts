import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { YTextEvent } from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  mapCaret,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_NOTE_1000, PASTE_1200, RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';

type Ops = Array<{ retain?: number; insert?: string; delete?: number }>;

/** Record the Y.Text delta events produced by `fn`. */
/**
 * Record the Y.Text delta events produced by `fn`.
 *
 * `YEvent.delta` is a computed property that is only reliable *during* the
 * observer call, so the ops are copied out inside the callback (per the Yjs
 * docs: "A safe way to collect changes is to store the changes or the delta
 * object").
 */
function recordDelta(ytext: Y.Text, fn: () => void): { ops: Ops; updates: number } {
  const ops: Ops = [];
  let updates = 0;
  const onUpdate = () => {
    updates += 1;
  };
  const observer = (event: YTextEvent) => {
    ops.push(...([ ...event.delta ] as Ops));
  };
  ytext.doc?.on('update', onUpdate);
  ytext.observe(observer);
  try {
    fn();
  } finally {
    ytext.unobserve(observer);
    ytext.doc?.off('update', onUpdate);
  }
  return { ops, updates };
}

function docWithText(value: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (value) ytext.insert(0, value);
  return { doc, ytext };
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('sticky.text: applyTextDiff (TC-13)', () => {
  it('inserts a single character with retain + insert, not delete-all/insert-all', () => {
    const { ytext } = docWithText('abc');
    const { ops, updates } = recordDelta(ytext, () => {
      applyTextDiff(ytext, 'abXc', null);
    });
    expect(ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('abXc');
    expect(updates).toBe(1);
  });

  it('deletes a run in the middle with retain + delete', () => {
    const { ytext } = docWithText('abcdef');
    const { ops } = recordDelta(ytext, () => {
      applyTextDiff(ytext, 'abef', null);
    });
    expect(ops).toEqual([{ retain: 2 }, { delete: 2 }]);
    expect(ytext.toString()).toBe('abef');
  });

  it('replaces a selection with one delete and one insert', () => {
    const { ytext } = docWithText('Faster onboarding');
    const { ops } = recordDelta(ytext, () => {
      applyTextDiff(ytext, 'Faster onboardings', null);
    });
    expect(ops).toEqual([{ retain: 17 }, { insert: 's' }]);

    const other = docWithText('one example board');
    const replaced = recordDelta(other.ytext, () => {
      applyTextDiff(other.ytext, 'one tiny board', null);
    });
    expect(replaced.ops).toEqual([{ retain: 4 }, { delete: 7 }, { insert: 'tiny' }]);
    expect(other.ytext.toString()).toBe('one tiny board');
  });

  it('keeps emoji surrogate pairs intact', () => {
    const cases: Array<[string, string]> = [
      ['a\u{1F600}b', 'a\u{1F4A1}b'], // swap one emoji for another
      ['a\u{1F600}b', 'aX\u{1F600}b'], // insert before an emoji
      ['a\u{1F600}b', 'a\u{1F600}b\u{1F44D}'], // append an emoji
      ['\u{1F600}\u{1F600}', '\u{1F600}'], // delete one emoji of two
      ['a\u{1F600}b', 'ab'], // delete the only emoji
    ];
    for (const [before, after] of cases) {
      const { ytext } = docWithText(before);
      recordDelta(ytext, () => {
        applyTextDiff(ytext, after, null);
      });
      expect(ytext.toString()).toBe(after);
      expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    }
  });

  it('writes nothing when the text did not change', () => {
    const { ytext } = docWithText(SHORT_NOTE);
    const { ops, updates } = recordDelta(ytext, () => {
      applyTextDiff(ytext, SHORT_NOTE, null);
    });
    expect(ops).toEqual([]);
    expect(updates).toBe(0);
  });

  it('supports a full append to and from an empty note', () => {
    const { ytext } = docWithText('');
    const { ops } = recordDelta(ytext, () => {
      applyTextDiff(ytext, LONG_NOTE_1000, null);
    });
    expect(ops).toEqual([{ insert: LONG_NOTE_1000 }]);
    expect(ytext.toString()).toBe(LONG_NOTE_1000);

    const cleared = recordDelta(ytext, () => {
      applyTextDiff(ytext, '', null);
    });
    expect(cleared.ops).toEqual([{ delete: STICKY_TEXT_MAX_CHARS }]);
    expect(ytext.toString()).toBe('');
  });

  it('multi-line paste is one insert, and later edits stay minimal', () => {
    const { ytext } = docWithText('');
    const first = recordDelta(ytext, () => {
      applyTextDiff(ytext, RETRO_ITEM, null);
    });
    expect(first.ops).toEqual([{ insert: RETRO_ITEM }]);
    const second = recordDelta(ytext, () => {
      applyTextDiff(ytext, `${RETRO_ITEM}!`, null);
    });
    expect(second.ops).toEqual([{ retain: RETRO_ITEM.length }, { insert: '!' }]);
  });

  it('runs in a single transaction with the given origin', () => {
    const { doc, ytext } = docWithText('abc');
    const origin = Symbol('sticky-test');
    const origins: unknown[] = [];
    const listener = (_u: Uint8Array, o: unknown) => {
      origins.push(o);
    };
    doc.on('update', listener);
    applyTextDiff(ytext, 'abcd', origin);
    doc.off('update', listener);
    expect(origins).toEqual([origin]);
  });
});

describe('sticky.text: clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14 keeps exactly the first 1,000 characters of a 1,200 character paste', () => {
    expect(PASTE_1200.length).toBe(1200);
    const clamped = clampToLimit(PASTE_1200);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PASTE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 accepts the 1,000th character (999 + 1)', () => {
    const at999 = LONG_NOTE_1000.slice(0, 999);
    const next = clampToLimit(`${at999}x`);
    expect(next.length).toBe(1000);
    expect(next).toBe(`${at999}x`);
  });

  it('TC-16 drops the 1,001st character (1,000 + 1)', () => {
    const next = clampToLimit(`${LONG_NOTE_1000}x`);
    expect(next.length).toBe(1000);
    expect(next).toBe(LONG_NOTE_1000);
  });

  it('leaves text under the limit untouched and honours an explicit max', () => {
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });

  it('never splits a surrogate pair at the limit', () => {
    const emojiAtBoundary = `${'x'.repeat(STICKY_TEXT_MAX_CHARS - 1)}\u{1F600}`;
    const clamped = clampToLimit(emojiAtBoundary);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS - 1);
    expect(hasLoneSurrogate(clamped)).toBe(false);
  });
});

describe('sticky.text: counterVisible (TC-17)', () => {
  it('shows the counter only when 50 or fewer characters remain', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
    expect(counterVisible(999)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
    expect(counterVisible(0)).toBe(false);
  });

  it('is false for every length with more than the threshold remaining', () => {
    for (let len = 0; len <= STICKY_TEXT_MAX_CHARS; len += 1) {
      const remaining = STICKY_TEXT_MAX_CHARS - len;
      expect(counterVisible(len)).toBe(remaining <= STICKY_COUNTER_THRESHOLD_CHARS);
    }
  });
});

/**
 * Font fit is verified against real text layout in e2e (TC-33); here the binary
 * search itself is checked with a simulated measurement, because jsdom and node
 * have no layout engine.
 */
describe('sticky.text: fitFontSize', () => {
  const BOX = 200;

  /** Element stub: scrollHeight grows linearly with the font size. */
  function fakeElement(pxPerLine: number, lines: number): {
    el: HTMLElement;
    sizes: number[];
  } {
    const sizes: number[] = [];
    let fontPx = STICKY_FONT_MAX_PX;
    const el = {
      style: {
        get fontSize() {
          return `${fontPx}px`;
        },
        set fontSize(value: string) {
          fontPx = parseFloat(value);
          sizes.push(fontPx);
        },
      },
      get scrollHeight() {
        return lines * fontPx * pxPerLine;
      },
    } as unknown as HTMLElement;
    return { el, sizes };
  }

  it('returns the maximum font size for short text', () => {
    const { el } = fakeElement(1.2, 1); // 1 line: fits at 24px
    expect(fitFontSize(el, BOX)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  });

  it('picks the largest size that fits and never exceeds the range', () => {
    // 6 lines at 1.2 line-height: needs fontPx <= 200 / 7.2 = 27.7 → max fits.
    const fitsMax = fitFontSize(fakeElement(1.2, 6).el, BOX);
    expect(fitsMax).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

    // 10 lines: needs fontPx <= 200/12 ≈ 16.6 → 16.
    const mid = fitFontSize(fakeElement(1.2, 10).el, BOX);
    expect(mid.fontPx).toBe(16);
    expect(mid.overflow).toBe(false);

    // 20 lines: even the minimum does not fit → minimum size + overflow.
    const over = fitFontSize(fakeElement(1.2, 20).el, BOX);
    expect(over).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
  });

  it('searches within the configured range only', () => {
    const { el, sizes } = fakeElement(1.2, 20);
    fitFontSize(el, BOX);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(size).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    }
  });
});

describe('sticky.sync: mapCaret moves the local caret through a remote edit', () => {
  it('keeps a caret before an inserted run where it was', () => {
    // Remote inserted 'B' at the very start.
    expect(mapCaret('AAA', 'BAAA', 0)).toBe(0);
    expect(mapCaret('AAA', 'BAAA', 3)).toBe(4);
    expect(mapCaret('AAA', 'AAABB', 2)).toBe(2);
  });

  it('keeps a caret after a deleted run shifted back', () => {
    expect(mapCaret('AAABBB', 'AAA', 6)).toBe(3);
    expect(mapCaret('AAABBB', 'AAA', 3)).toBe(3);
    expect(mapCaret('xAAA', 'AAA', 4)).toBe(3);
  });

  it('places a caret that was inside the changed run after the new text', () => {
    expect(mapCaret('one example board', 'one tiny board', 8)).toBe(4 + 'tiny'.length);
  });

  it('never returns a caret outside the new text', () => {
    expect(mapCaret('abcdef', '', 6)).toBe(0);
    expect(mapCaret('', 'abc', 0)).toBe(0);
    expect(mapCaret('abc', 'abc', 3)).toBe(3);
  });
});
