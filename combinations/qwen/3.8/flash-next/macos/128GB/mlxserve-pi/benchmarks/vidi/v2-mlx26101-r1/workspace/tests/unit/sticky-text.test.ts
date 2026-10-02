import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  RETRO_ITEM,
  SHORT_PHRASE,
  THOUSAND_CHARS,
  TWELVE_HUNDRED_CHARS,
} from '../fixtures/texts';

interface Op {
  retain?: number;
  insert?: string;
  delete?: number;
}

/** Capture the delta Y.Text emits while `fn` runs. */
function deltaOf(ytext: Y.Text, fn: () => void): Op[][] {
  const deltas: Op[][] = [];
  const observer = (event: Y.YTextEvent) => {
    deltas.push(event.delta as Op[]);
  };
  ytext.observe(observer);
  try {
    fn();
  } finally {
    ytext.unobserve(observer);
  }
  return deltas;
}

/** The editor's real commit path: clamp the candidate, then diff into Y.Text. */
function commit(ytext: Y.Text, next: string): void {
  applyTextDiff(ytext, clampToLimit(next), LOCAL_ORIGIN);
}

function doc(): { ytext: Y.Text } {
  const d = new Y.Doc();
  const ytext = d.getText('t');
  return { ytext };
}

describe('sticky.text logic', () => {
  it('fixtures are realistic and have the expected shapes', () => {
    expect(SHORT_PHRASE).toBe('Faster onboarding');
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(RETRO_ITEM.length).toBeGreaterThan(80);
    expect(THOUSAND_CHARS).toHaveLength(1000);
    expect(TWELVE_HUNDRED_CHARS).toHaveLength(1200);
    // Prose, not a single repeated character.
    expect(new Set(THOUSAND_CHARS).size).toBeGreaterThan(20);
  });

  it('TC-13 applyTextDiff "abc" -> "abXc" is a single insert of "X" at index 2', () => {
    const { ytext } = doc();
    ytext.insert(0, 'abc');
    const deltas = deltaOf(ytext, () => applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN));
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13b applyTextDiff in the middle of existing text is a single insert', () => {
    const { ytext } = doc();
    ytext.insert(0, 'Faster onboarding');
    const deltas = deltaOf(ytext, () =>
      applyTextDiff(ytext, 'Faster Xonboarding', LOCAL_ORIGIN),
    );
    expect(ytext.toString()).toBe('Faster Xonboarding');
    // Minimal: it retains the common prefix rather than deleting+re-inserting all.
    expect(deltas[0]![0]).toEqual({ retain: 7 });
    const totalDelete = deltas[0]!.reduce((n, op) => n + (op.delete ?? 0), 0);
    expect(totalDelete).toBe(0);
  });

  it('TC-13c pure deletion in the middle is a single delete', () => {
    const { ytext } = doc();
    ytext.insert(0, 'abc');
    const deltas = deltaOf(ytext, () => applyTextDiff(ytext, 'ac', LOCAL_ORIGIN));
    expect(ytext.toString()).toBe('ac');
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 1 }]);
  });

  it('TC-13d replacing a selection is one delete and one insert (not a full replace)', () => {
    const { ytext } = doc();
    ytext.insert(0, 'hello');
    const deltas = deltaOf(ytext, () =>
      applyTextDiff(ytext, 'hXo', LOCAL_ORIGIN),
    );
    expect(ytext.toString()).toBe('hXo');
    // Common prefix "h" retained; never deletes all 5 old chars.
    expect(deltas[0]![0]).toEqual({ retain: 1 });
    const totalDelete = deltas[0]!.reduce((n, op) => n + (op.delete ?? 0), 0);
    expect(totalDelete).toBeLessThan(5);
    const inserted = deltas[0]!
      .filter((op) => op.insert !== undefined)
      .map((op) => op.insert)
      .join('');
    expect(inserted).toBe('X');
  });

  it('TC-13e no change produces no transaction / no delta', () => {
    const { ytext } = doc();
    ytext.insert(0, 'abc');
    const deltas = deltaOf(ytext, () => applyTextDiff(ytext, 'abc', LOCAL_ORIGIN));
    expect(deltas).toHaveLength(0);
  });

  it('TC-13f keeps emoji surrogate pairs intact', () => {
    const { ytext } = doc();
    applyTextDiff(ytext, 'a\u{1F44D}b', LOCAL_ORIGIN); // a 👍 b
    expect(ytext.toString()).toBe('a\u{1F44D}b');
    // Editing after the emoji must not split the surrogate pair.
    applyTextDiff(ytext, 'a\u{1F44D}c', LOCAL_ORIGIN);
    const s = ytext.toString();
    expect(s).toBe('a\u{1F44D}c');
    expect(s).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no lone high surrogate
  });

  it('TC-14 pasting 1,200 characters into an empty note keeps exactly 1,000', () => {
    const { ytext } = doc();
    commit(ytext, TWELVE_HUNDRED_CHARS);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(THOUSAND_CHARS);
  });

  it('TC-15 inserting one char at 999 is accepted (reaches exactly 1,000)', () => {
    const { ytext } = doc();
    ytext.insert(0, THOUSAND_CHARS.slice(0, 999));
    commit(ytext, THOUSAND_CHARS); // 1000 chars
    expect(ytext.toString()).toHaveLength(1000);
  });

  it('TC-16 inserting one char at 1,000 does not grow past the limit', () => {
    const { ytext } = doc();
    ytext.insert(0, THOUSAND_CHARS);
    commit(ytext, THOUSAND_CHARS + 'x'); // 1001 chars
    expect(ytext.toString()).toHaveLength(1000);
    expect(ytext.toString()).toBe(THOUSAND_CHARS); // the trailing 'x' dropped
  });

  it('clampToLimit clamps to a custom max and leaves short strings untouched', () => {
    expect(clampToLimit('abc', 2)).toBe('ab');
    expect(clampToLimit('abc')).toBe('abc');
    expect(clampToLimit('x'.repeat(1200)).length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-17 counterVisible switches on at the threshold boundary', () => {
    // remaining = max - length; visible when remaining <= threshold.
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // remaining 51
    expect(counterVisible(950)).toBe(true); // remaining 50
    expect(counterVisible(951)).toBe(true); // remaining 49
  });
});
