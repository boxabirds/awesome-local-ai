import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';

/** Realistic English prose (design fixture: not repeated single characters). */
const WORDS =
  'the quick brown fox jumps over a lazy dog while farmers watch from quiet porches and children laugh loudly outside every evening together'.split(
    ' ',
  );
const prose = (min: number): string => {
  let out = '';
  let i = 0;
  while (out.length < min) {
    out += (out ? ' ' : '') + (WORDS[i % WORDS.length] ?? '');
    i += 1;
  }
  return out;
};
const exact = (n: number): string => prose(n).slice(0, n);

/** A doc + Y.Text seeded with `initial`. */
const seed = (initial: string): { doc: Y.Doc; text: Y.Text } => {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  doc.transact(() => {
    if (initial) text.insert(0, initial);
  });
  return { doc, text };
};

/** Capture the deltas Y.Text observes on the next applyTextDiff call. */
const captureDelta = (
  text: Y.Text,
  run: () => void,
): { deltas: unknown[][]; updates: number } => {
  const deltas: unknown[][] = [];
  let updates = 0;
  const observe = (event: Y.YTextEvent): void => {
    if (event.delta) deltas.push(event.delta);
  };
  const onUpdate = (): void => {
    updates += 1;
  };
  text.observe(observe);
  text.doc?.on('update', onUpdate);
  run();
  text.unobserve(observe);
  text.doc?.off('update', onUpdate);
  return { deltas, updates };
};

describe('sticky.text: applyTextDiff (TC-13)', () => {
  it('TC-13 turns abc -> abXc into a single insert of X at index 2', () => {
    const { text } = seed('abc');
    const { deltas, updates } = captureDelta(text, () => {
      applyTextDiff(text, 'abXc', 'origin');
    });
    expect(text.toString()).toBe('abXc');
    expect(updates).toBe(1);
    expect(deltas).toHaveLength(1);
    // A single insert op, NOT delete-all + insert-all.
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13 turns abcd -> ad into a single delete in the middle', () => {
    const { text } = seed('abcd');
    const { deltas } = captureDelta(text, () => {
      applyTextDiff(text, 'ad', 'origin');
    });
    expect(text.toString()).toBe('ad');
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 2 }]);
  });

  it('TC-13 replaces a selection with the smallest delete + insert', () => {
    const { text } = seed('hello world');
    const { deltas } = captureDelta(text, () => {
      applyTextDiff(text, 'hello bright world', 'origin');
    });
    expect(text.toString()).toBe('hello bright world');
    // Common prefix "hello " is retained; this is really a pure insertion, so
    // Yjs emits a single insert op and no trailing retain (TC-13: minimal).
    expect(deltas[0]).toEqual([{ retain: 6 }, { insert: 'bright ' }]);
  });

  it('TC-13 keeps surrogate pairs intact when editing around an emoji', () => {
    const { text } = seed('a\u{1F600}b');
    const { deltas } = captureDelta(text, () => {
      applyTextDiff(text, 'a\u{1F600}c', 'origin');
    });
    expect(text.toString()).toBe('a\u{1F600}c');
    // The emoji (two code units after "a") is only retained, never rewritten.
    expect(deltas[0]?.[0]).toEqual({ retain: 3 });
    expect(text.toString().includes('\u{1F600}')).toBe(true);
  });

  it('emits no transaction when the text is unchanged', () => {
    const { text } = seed('same');
    const { updates } = captureDelta(text, () => {
      applyTextDiff(text, 'same', 'origin');
    });
    expect(updates).toBe(0);
  });
});

describe('sticky.text: clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14 keeps exactly the first 1,000 of a 1,200 character paste', () => {
    const pasted = exact(1200);
    const clamped = clampToLimit(pasted);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 accepts the 1,000th character (999 + 1)', () => {
    const base = exact(999);
    const result = clampToLimit(`${base}X`);
    expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result.endsWith('X')).toBe(true);
  });

  it('TC-16 rejects the 1,001st character (1,000 + 1)', () => {
    const base = exact(1000);
    const result = clampToLimit(`${base}X`);
    expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(base);
  });

  it('leaves a custom max length honoured', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('sticky.text: counterVisible (TC-17)', () => {
  it('shows the counter once remaining is at most the threshold', () => {
    const threshold = STICKY_COUNTER_THRESHOLD_CHARS;
    // remaining 51 / 50 / 49 -> false / true / true
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - (threshold + 1))).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - threshold)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - (threshold - 1))).toBe(true);
    // 949 / 950 / 951 characters.
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    // Empty text: nothing to warn about.
    expect(counterVisible(0)).toBe(false);
  });
});
