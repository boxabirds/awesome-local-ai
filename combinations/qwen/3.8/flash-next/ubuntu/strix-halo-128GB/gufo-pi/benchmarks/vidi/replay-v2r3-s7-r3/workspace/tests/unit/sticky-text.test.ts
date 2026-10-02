import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
  fitFontSize,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../src/shared/config';

const STICKY_SIZE_BOX = 200;
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { LONG_NOTE_1000, OVER_LIMIT_1200, SHORT_NOTE } from '../fixtures/texts';

function attach(initial = ''): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (initial) ytext.insert(0, initial);
  return { doc, ytext };
}

function recordDeltas(ytext: Y.Text) {
  const deltas: unknown[] = [];
  const handler = (e: Y.YTextEvent) => {
    for (const d of e.delta) deltas.push(d);
  };
  ytext.observe(handler);
  return () => {
    ytext.unobserve(handler);
    return deltas;
  };
}

describe('sticky.text — applyTextDiff (TC-13)', () => {
  it('inserting one character emits a single insert, not delete-all + insert-all', () => {
    const { ytext } = attach('abc');
    const stop = recordDeltas(ytext);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    expect(stop()).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('deleting in the middle emits a single delete', () => {
    const { ytext } = attach('abcde');
    const stop = recordDeltas(ytext);

    applyTextDiff(ytext, 'abde', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abde');
    expect(stop()).toEqual([{ retain: 2 }, { delete: 1 }]);
  });

  it('replacing a selection emits one delete plus one insert', () => {
    const { ytext } = attach(SHORT_NOTE);
    const stop = recordDeltas(ytext);

    applyTextDiff(ytext, 'Faster offboarding', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('Faster offboarding');
    expect(stop()).toEqual([{ retain: 8 }, { delete: 1 }, { insert: 'ff' }]);
  });

  it('keeps emoji surrogate pairs intact when the neighbouring text changes', () => {
    const { ytext } = attach('a\u{1F600}');
    applyTextDiff(ytext, 'b\u{1F600}', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('b\u{1F600}');
    // No lone surrogate may survive a diff at a surrogate-pair boundary.
    expect(ytext.toString()).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(ytext.toString()).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('an emoji-only change keeps the pair whole', () => {
    const { ytext } = attach('a\u{1F600}b');
    applyTextDiff(ytext, 'a\u{1F601}b', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('a\u{1F601}b');
  });

  it('no change writes nothing and opens no transaction', () => {
    const { doc, ytext } = attach(SHORT_NOTE);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const stop = recordDeltas(ytext);

    applyTextDiff(ytext, SHORT_NOTE, LOCAL_ORIGIN);

    expect(updates).toBe(0);
    expect(stop()).toEqual([]);
  });

  it('appending to a long note emits only the appended insert', () => {
    const { ytext } = attach(LONG_NOTE_1000.slice(0, 999));
    const stop = recordDeltas(ytext);

    applyTextDiff(ytext, LONG_NOTE_1000, LOCAL_ORIGIN);

    expect(ytext.toString()).toBe(LONG_NOTE_1000);
    expect(stop()).toEqual([{ retain: 999 }, { insert: LONG_NOTE_1000.slice(999) }]);
  });
});

describe('sticky.text — clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14 keeps exactly the first 1,000 characters of a 1,200 character paste', () => {
    expect(OVER_LIMIT_1200).toHaveLength(1200);
    const clamped = clampToLimit(OVER_LIMIT_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(OVER_LIMIT_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('leaves text at or below the limit untouched', () => {
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    const atLimit = LONG_NOTE_1000;
    expect(atLimit).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit)).toBe(atLimit);
  });

  it('TC-15 accepts the 1,000th character (boundary)', () => {
    const { ytext } = attach(LONG_NOTE_1000.slice(0, 999));
    const next = clampToLimit(LONG_NOTE_1000);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 does not grow text beyond 1,000 characters', () => {
    const { ytext } = attach(LONG_NOTE_1000);
    const next = clampToLimit(LONG_NOTE_1000 + '!');
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(LONG_NOTE_1000);
  });

  it('honours an explicit max argument', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });

  it('never splits a surrogate pair at the limit', () => {
    const withEmoji = 'a'.repeat(STICKY_TEXT_MAX_CHARS - 1) + '\u{1F600}';
    const clamped = clampToLimit(withEmoji);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS - 1);
    expect(clamped).toBe('a'.repeat(STICKY_TEXT_MAX_CHARS - 1));
  });
});

describe('sticky.text — counterVisible (TC-17)', () => {
  it('shows the counter when 50 or fewer characters remain', () => {
    const limit = STICKY_TEXT_MAX_CHARS;
    expect(counterVisible(limit - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false); // 949
    expect(counterVisible(limit - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true); // 950
    expect(counterVisible(limit - STICKY_COUNTER_THRESHOLD_CHARS + 1)).toBe(true); // 951
  });

  it('is false for short and empty notes', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});

describe('sticky.text — fitFontSize', () => {
  /** Fake element: scrollHeight is a deterministic function of the font size set on it. */
  function fakeEl(lines: number): { el: HTMLElement; sizes: number[] } {
    const sizes: number[] = [];
    const style: Record<string, string> = {};
    const el = {
      style,
      get scrollHeight() {
        const px = parseFloat(style.fontSize);
        sizes.push(px);
        return px * lines;
      },
    };
    return { el: el as unknown as HTMLElement, sizes };
  }

  it('returns the maximum size when the text always fits', () => {
    const { el } = fakeEl(1);
    const result = fitFontSize(el, STICKY_SIZE_BOX);
    expect(result.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(result.overflow).toBe(false);
  });

  it('binary-searches the largest size that fits the box', () => {
    // 10 lines of text: largest px with 10 * px <= 180 is 18.
    const { el, sizes } = fakeEl(10);
    const result = fitFontSize(el, 180);
    expect(result.fontPx).toBe(18);
    expect(result.overflow).toBe(false);
    expect(sizes.length).toBeLessThanOrEqual(6); // binary search, not a linear scan of 15 sizes
  });

  it('reports overflow and keeps the minimum size when even that does not fit', () => {
    const { el } = fakeEl(30);
    const result = fitFontSize(el, 180);
    expect(result.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(result.overflow).toBe(true);
  });

  it('never goes below the minimum or above the maximum size', () => {
    const tiny = fakeEl(0.01);
    expect(fitFontSize(tiny.el, 100000).fontPx).toBe(STICKY_FONT_MAX_PX);
    const huge = fakeEl(10000);
    expect(fitFontSize(huge.el, 1).fontPx).toBe(STICKY_FONT_MIN_PX);
  });
});

