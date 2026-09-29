import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

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
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  LONG_PROSE,
  RETRO_ITEM,
  SHORT_IDEA,
  TEXT_1000,
  TEXT_1200,
  proseOfLength,
} from '../fixtures/texts';

/**
 * Unit tests for the pure text logic of `sticky.text`: the minimal
 * `Y.Text` diff, the 1,000 character limit, the counter rule and the font
 * auto-fit search. Real layout is covered by the e2e suite (TC-33); here the
 * fit search is driven by a measuring element whose `scrollHeight` is a simple
 * function of the font size it was last given.
 */

const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

/** A `Y.Text` inside a real document, so transactions and origins are real. */
function textHarness(initial: string): {
  doc: Y.Doc;
  ytext: Y.Text;
  deltas: Record<string, unknown>[];
  origins: unknown[];
  updates: number;
} {
  const doc = new Y.Doc();
  const ytext = doc.getText('text');
  ytext.insert(0, initial);
  const deltas: Record<string, unknown>[] = [];
  const origins: unknown[] = [];
  let updates = 0;
  ytext.observe((event) => {
    deltas.push(...(event.delta as unknown as Record<string, unknown>[]));
  });
  doc.on('update', (_update: unknown, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  });
  return { doc, ytext, deltas, origins, get updates(): number { return updates; } };
}

describe('sticky.text applyTextDiff (TC-13)', () => {
  it('TC-13 types one character as a single insert, not a rewrite', () => {
    const h = textHarness('abc');
    applyTextDiff(h.ytext, 'abXc', 'local');

    expect(h.ytext.toString()).toBe('abXc');
    expect(h.deltas).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(h.updates).toBe(1);
    expect(h.origins).toEqual(['local']);
  });

  it('TC-13 deletes a character in the middle as a single delete', () => {
    const h = textHarness('abcd');
    applyTextDiff(h.ytext, 'ad', 'local');
    expect(h.ytext.toString()).toBe('ad');
    expect(h.deltas).toEqual([{ retain: 1 }, { delete: 2 }]);
  });

  it('TC-13 replaces a selection as one delete plus one insert', () => {
    const h = textHarness('abcd');
    applyTextDiff(h.ytext, 'aXYd', 'local');
    expect(h.ytext.toString()).toBe('aXYd');
    expect(h.deltas).toEqual([{ retain: 1 }, { delete: 2 }, { insert: 'XY' }]);
  });

  it('TC-13 writes nothing when the text did not change', () => {
    const h = textHarness(SHORT_IDEA);
    applyTextDiff(h.ytext, SHORT_IDEA, 'local');
    expect(h.deltas).toEqual([]);
    expect(h.updates).toBe(0);
  });

  it('TC-13 inserts into prose without touching the surrounding words', () => {
    const h = textHarness(LONG_PROSE.slice(0, 200));
    const before = h.ytext.toString();
    const next = `${before.slice(0, 100)}very ` + before.slice(100);
    applyTextDiff(h.ytext, next, 'local');
    expect(h.ytext.toString()).toBe(next);
    expect(h.deltas).toEqual([{ retain: 100 }, { insert: 'very ' }]);
  });

  it('TC-13 keeps multi-line notes line by line', () => {
    const h = textHarness(RETRO_ITEM);
    const next = RETRO_ITEM.replace('weekly', 'every Friday');
    applyTextDiff(h.ytext, next, 'local');
    expect(h.ytext.toString()).toBe(next);
    // exactly one delete and one insert, both inside the edited word
    expect(h.deltas.filter((d) => 'delete' in d)).toHaveLength(1);
    expect(h.deltas.filter((d) => 'insert' in d)).toHaveLength(1);
    expect(h.deltas.filter((d) => 'retain' in d)).toHaveLength(1);
    expect((h.deltas[0] as { retain: number }).retain).toBeGreaterThan(0);
    expect((h.deltas[0] as { retain: number }).retain).toBeLessThan(20);
  });

  it('TC-13 never splits a surrogate pair and always ends up equal to the input', () => {
    const cases: Array<[string, string]> = [
      // type before and after an emoji: the pair is left alone
      ['a\u{1F600}b', 'aX\u{1F600}b'],
      ['a\u{1F600}b', 'a\u{1F600}Xb'],
      // delete the character in front of an emoji
      ['\u{1F600}ab', 'ab'],
      // delete the emoji itself
      ['hi \u{1F600} there', 'hi  there'],
      // swap one emoji for another
      ['\u{1F600}', '\u{1F601}'],
      // a boundary that would cut a pair in half if prefixes were naive
      ['a\u{1F600}b', 'a\u{1F600}c'],
    ];
    for (const [before, after] of cases) {
      const h = textHarness(before);
      applyTextDiff(h.ytext, after, 'local');
      expect(h.ytext.toString()).toBe(after);
      // no lone surrogates survive anywhere in the stored string
      for (let i = 0; i < h.ytext.toString().length; i += 1) {
        const code = h.ytext.toString().charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const nextCode = h.ytext.toString().charCodeAt(i + 1);
          expect(nextCode >= 0xdc00 && nextCode <= 0xdfff).toBe(true);
          i += 1;
        } else {
          expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
        }
      }
    }
  });

  it('TC-13 a diff after another diff still only reports the newest change', () => {
    const h = textHarness('');
    applyTextDiff(h.ytext, 'Faster onboarding', 'local');
    h.deltas.length = 0;
    applyTextDiff(h.ytext, 'Faster onboarding!', 'local');
    expect(h.deltas).toEqual([{ retain: 17 }, { insert: '!' }]);
  });
});

describe('sticky.text length limit (TC-14, TC-15, TC-16)', () => {
  it('TC-14 keeps the first 1,000 characters of a 1,200 character paste', () => {
    expect(TEXT_1200).toHaveLength(STICKY_TEXT_MAX_CHARS + 200);
    const kept = clampToLimit(TEXT_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(TEXT_1000);
  });

  it('TC-14 applies the same limit through the shared text', () => {
    const h = textHarness('');
    applyTextDiff(h.ytext, clampToLimit(TEXT_1200), 'local');
    expect(h.ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(h.ytext.toString()).toBe(TEXT_1000);
  });

  it('TC-15 accepts the character that reaches exactly 1,000', () => {
    const at999 = proseOfLength(STICKY_TEXT_MAX_CHARS - 1);
    const next = clampToLimit(`${at999}!`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next.endsWith('!')).toBe(true);

    const h = textHarness(at999);
    applyTextDiff(h.ytext, next, 'local');
    expect(h.ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(h.updates).toBe(1);
  });

  it('TC-16 rejects the character past 1,000', () => {
    const at1000 = proseOfLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(`${at1000}!`)).toBe(at1000);
    expect(clampToLimit(`${at1000}!!!`)).toBe(at1000);

    const h = textHarness(at1000);
    applyTextDiff(h.ytext, clampToLimit(`${at1000}!`), 'local');
    expect(h.ytext.toString()).toBe(at1000);
    expect(h.updates).toBe(0);
  });

  it('keeps text below the limit untouched and honours an explicit max', () => {
    expect(clampToLimit(SHORT_IDEA)).toBe(SHORT_IDEA);
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('')).toBe('');
  });

  it('counts surrogate pairs as the characters a textarea counts', () => {
    // a textarea keeps UTF-16 units, and the limit is defined on them
    const near = `${proseOfLength(STICKY_TEXT_MAX_CHARS - 2)}\u{1F600}`;
    expect(clampToLimit(near)).toBe(near.slice(0, STICKY_TEXT_MAX_CHARS));
  });
});

describe('sticky.text counterVisible (TC-17)', () => {
  it('TC-17 appears at 50 characters remaining and not one before', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 51)).toBe(false); // 949
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 50)).toBe(true); // 950
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 49)).toBe(true); // 951
  });

  it('is hidden on an empty note and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});

/**
 * A stand-in for a measured element: `scrollHeight` grows with the font size
 * the fit search last wrote into `style.fontSize`, the way a wrapped block of
 * `lines` lines does.
 */
function measurable(lines: number): HTMLElement & { style: { fontSize: string } } {
  const style = { fontSize: '' };
  const element = {
    style,
    get scrollHeight(): number {
      const px = Number.parseFloat(style.fontSize);
      return Math.ceil(lines * px * STICKY_LINE_HEIGHT);
    },
  };
  return element as unknown as HTMLElement & { style: { fontSize: string } };
}

function chosenFont(el: HTMLElement & { style: { fontSize: string } }): number {
  return Number.parseFloat(el.style.fontSize);
}

describe('sticky.text fitFontSize', () => {
  it('uses the largest size for text that fits at it', () => {
    const el = measurable(1);
    expect(fitFontSize(el, TEXT_BOX)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
    expect(chosenFont(el)).toBe(STICKY_FONT_MAX_PX);
  });

  it('shrinks to the largest size that still fits', () => {
    const el = measurable(6);
    const fit = fitFontSize(el, TEXT_BOX);
    // 6 lines * 1.3 * size <= 168  =>  size <= 21.5
    expect(fit.fontPx).toBe(21);
    expect(fit.overflow).toBe(false);
    expect(chosenFont(el)).toBe(21);
  });

  it('reaches the minimum, then reports overflow', () => {
    const el = measurable(20);
    const fit = fitFontSize(el, TEXT_BOX);
    expect(fit).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
    expect(chosenFont(el)).toBe(STICKY_FONT_MIN_PX);
  });

  it('only ever picks an integer size inside the allowed range', () => {
    for (let lines = 1; lines <= 30; lines += 1) {
      const fit = fitFontSize(measurable(lines), TEXT_BOX);
      expect(Number.isInteger(fit.fontPx)).toBe(true);
      expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(fit.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    }
  });

  it('never claims overflow for a box that is big enough', () => {
    expect(fitFontSize(measurable(30), 10_000).overflow).toBe(false);
  });
});
