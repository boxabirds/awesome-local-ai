/**
 * Unit tests for the pure parts of sticky.text (TC-13 to TC-17) against a real
 * Y.Text. Fixtures are realistic English prose, not repeated single characters.
 */
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

/** ~230 chars of English prose. */
const PROSE =
  'The quick brown fox jumps over the lazy dog while the team reviews the ' +
  'retrospective notes and groups them into themes that surface blockers, ' +
  'wins and follow-up actions for the next iteration of the product roadmap. ' +
  'Nothing here repeats a single character, because repeated characters lay ' +
  'out unrealistically and hide measurement bugs.';

/** English prose grown to exactly `length` characters. */
const proseOfLength = (length: number): string => {
  let text = '';
  while (text.length < length) text += PROSE + ' ';
  return text.slice(0, length);
};

describe('applyTextDiff', () => {
  it('TC-13: turning "abc" into "abXc" is a single insert of "X" at index 2', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    doc.transact(() => ytext.insert(0, 'abc'), LOCAL_ORIGIN);

    const deltas: unknown[][] = [];
    ytext.observe((event) => deltas.push(event.delta));
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    // Exactly one retain + one insert: no delete-all + insert-all, which would
    // destroy concurrent typing once story 3 ships.
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('a pure deletion in the middle is a single delete', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    doc.transact(() => ytext.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);

    const deltas: unknown[][] = [];
    ytext.observe((event) => deltas.push(event.delta));
    applyTextDiff(ytext, 'Faster onding', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('Faster onding');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 9 }, { delete: 4 }]);
  });

  it('replacing a selection is one delete and one insert', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    doc.transact(() => ytext.insert(0, 'weekly retro'), LOCAL_ORIGIN);

    const deltas: unknown[][] = [];
    ytext.observe((event) => deltas.push(event.delta));
    applyTextDiff(ytext, 'daily retro', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('daily retro');
    expect(deltas).toHaveLength(1);
    // A single delete followed by a single insert (retain counts may be absent).
    const ops = deltas[0].filter(
      (op): op is { insert?: string; delete?: number } => typeof op === 'object' && op !== null,
    );
    const deletes = ops.filter((op) => 'delete' in op);
    const inserts = ops.filter((op) => 'insert' in op);
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });

  it('surrogate pairs (emoji) are kept intact', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    doc.transact(() => ytext.insert(0, 'Ship it \u{1F680} today'), LOCAL_ORIGIN);
    applyTextDiff(ytext, 'Ship it \u{1F680} tomorrow', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Ship it \u{1F680} tomorrow');
    // The rocket emoji must still be one intact code point.
    expect([...ytext.toString()].includes('\u{1F680}')).toBe(true);
    // Replacing only the emoji works too.
    applyTextDiff(ytext, 'Ship it \u{1F389} tomorrow', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Ship it \u{1F389} tomorrow');
  });

  it('an identical string is a no-op with no Y.Text event', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    doc.transact(() => ytext.insert(0, 'same'), LOCAL_ORIGIN);
    const deltas: unknown[][] = [];
    ytext.observe((event) => deltas.push(event.delta));
    applyTextDiff(ytext, 'same', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(0);
  });

  it('works on realistic long text', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    const base = proseOfLength(500);
    doc.transact(() => ytext.insert(0, base), LOCAL_ORIGIN);
    applyTextDiff(ytext, base + ' and more', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(base + ' and more');
  });
});

describe('clampToLimit', () => {
  it('TC-14: a paste of 1,200 characters into an empty note keeps exactly 1,000', () => {
    const pasted = proseOfLength(1200);
    const clamped = clampToLimit(pasted);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('leaves shorter text untouched', () => {
    expect(clampToLimit('hello')).toBe('hello');
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(proseOfLength(STICKY_TEXT_MAX_CHARS))).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });
});

describe('text length boundaries through clampToLimit', () => {
  it('TC-15: 999 + 1 characters = 1,000 accepted', () => {
    const base = proseOfLength(999);
    const next = clampToLimit(base + 'x');
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(base + 'x');
  });

  it('TC-16: 1,000 + 1 characters is rejected; still 1,000', () => {
    const base = proseOfLength(STICKY_TEXT_MAX_CHARS);
    const next = clampToLimit(base + 'x');
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(base);
  });
});

describe('counterVisible', () => {
  it('TC-17: appears at remaining <= STICKY_COUNTER_THRESHOLD_CHARS', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    // 949 -> 51 remaining: hidden.
    expect(counterVisible(949)).toBe(false);
    // 950 -> exactly 50 remaining: visible (boundary).
    expect(counterVisible(950)).toBe(true);
    // 951 -> 49 remaining: visible.
    expect(counterVisible(951)).toBe(true);
    // And obviously not for a fresh note.
    expect(counterVisible(0)).toBe(false);
  });
});
