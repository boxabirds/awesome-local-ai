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
import { LONG_PROSE, OVERLONG_PROSE, RETRO_ITEM } from '../fixtures/texts';

/**
 * Unit tests for the pure text helpers (TC-13 to TC-17) against a real Y.Text.
 *
 * The shape of the emitted delta matters more than the resulting string: a
 * full replace (delete everything + insert everything) would destroy text
 * typed concurrently by another user as soon as story 3 ships, so the tests
 * pin the minimal op sequence.
 */

/** A Y.Text attached to a real doc, pre-filled with `initial`. */
function textWith(initial: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const note = new Y.Map<unknown>();
  const ytext = new Y.Text();
  note.set('text', ytext);
  objects.set('n1', note);
  if (initial.length > 0) ytext.insert(0, initial);
  return { doc, ytext };
}

/** Collect the delta of every observed change made while `fn` runs. */
function observe(ytext: Y.Text, fn: () => void): Record<string, unknown>[] {
  const delta: Record<string, unknown>[] = [];
  const listener = (event: Y.YTextEvent) => {
    delta.push(...(event.delta as Record<string, unknown>[]));
  };
  ytext.observe(listener);
  fn();
  ytext.unobserve(listener);
  return delta;
}

/** True when a string contains half of a surrogate pair. */
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

describe('applyTextDiff (TC-13)', () => {
  it('inserts a single character instead of replacing the whole text', () => {
    const { ytext } = textWith('abc');
    const delta = observe(ytext, () => {
      applyTextDiff(ytext, 'abXc', null);
    });
    expect(delta).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(delta).not.toEqual([{ delete: 3 }, { insert: 'abXc' }]);
    expect(ytext.toString()).toBe('abXc');
  });

  it('deletes only the removed run when text is shortened', () => {
    const { ytext } = textWith('abcdef');
    const delta = observe(ytext, () => {
      applyTextDiff(ytext, 'abef', null);
    });
    expect(delta).toEqual([{ retain: 2 }, { delete: 2 }]);
    expect(ytext.toString()).toBe('abef');
  });

  it('replaces a selected run with one delete and one insert', () => {
    const { ytext } = textWith('abcdef');
    const delta = observe(ytext, () => {
      applyTextDiff(ytext, 'abXef', null);
    });
    expect(delta).toEqual([{ retain: 2 }, { delete: 2 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('abXef');
  });

  it('keeps surrogate pairs intact when text around them changes', () => {
    const cases: Array<[string, string]> = [
      ['a\u{1F600}b', 'a\u{1F605}b'],
      ['\u{1F600}\u{1F600}', '\u{1F600}'],
      ['ideas \u{1F4A1} fast', 'ideas \u{1F4A1} faster onboarding'],
      ['a\u{1F600}b', 'ab'],
    ];
    for (const [before, after] of cases) {
      const { ytext } = textWith(before);
      observe(ytext, () => {
        applyTextDiff(ytext, after, null);
      });
      expect(ytext.toString()).toBe(after);
      expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    }
  });

  it('writes nothing when the text did not change', () => {
    const { ytext } = textWith(RETRO_ITEM);
    const delta = observe(ytext, () => {
      applyTextDiff(ytext, RETRO_ITEM, null);
    });
    expect(delta).toEqual([]);
    expect(ytext.toString()).toBe(RETRO_ITEM);
  });

  it('keeps newlines when a multi-line note is edited', () => {
    const { ytext } = textWith('one\ntwo\nthree');
    observe(ytext, () => {
      applyTextDiff(ytext, 'one\ntwo\nthree\nfour', null);
    });
    expect(ytext.toString()).toBe('one\ntwo\nthree\nfour');
  });
});

describe('clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14 cuts a 1,200 character paste at the 1,000 character limit', () => {
    expect(OVERLONG_PROSE).toHaveLength(1200);
    const clamped = clampToLimit(OVERLONG_PROSE);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(OVERLONG_PROSE.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-14 a pasted text is stored cut off, and the counter reads 1000/1000', () => {
    const { ytext } = textWith('');
    const clamped = clampToLimit(OVERLONG_PROSE);
    applyTextDiff(ytext, clamped, null);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(LONG_PROSE);
    expect(counterVisible(ytext.toString().length)).toBe(true);
  });

  it('TC-15 the 1,000th character is still accepted', () => {
    const base = LONG_PROSE.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(base).toHaveLength(999);
    const { ytext } = textWith(base);
    const next = clampToLimit(`${base}!`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(ytext, next, null);
    expect(ytext.toString()).toBe(next);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 a character past the limit is rejected and the text stays at 1,000', () => {
    const { ytext } = textWith(LONG_PROSE);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);

    const next = clampToLimit(`${LONG_PROSE}EXTRA`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(LONG_PROSE);

    const delta = observe(ytext, () => {
      applyTextDiff(ytext, next, null);
    });
    expect(delta).toEqual([]);
    expect(ytext.toString()).toBe(LONG_PROSE);
  });

  it('leaves short text and its custom limit alone', () => {
    expect(clampToLimit('Faster onboarding')).toBe('Faster onboarding');
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('counterVisible (TC-17)', () => {
  it('appears within the last 50 characters, boundary included', () => {
    const limit = STICKY_TEXT_MAX_CHARS;
    expect(limit - STICKY_COUNTER_THRESHOLD_CHARS).toBe(950);
    // 51 characters left: still hidden.
    expect(counterVisible(949)).toBe(false);
    // Exactly 50 left: shown.
    expect(counterVisible(950)).toBe(true);
    // 49 left: shown.
    expect(counterVisible(951)).toBe(true);
  });

  it('stays hidden for short notes and reports the full note as visible', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(RETRO_ITEM.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
