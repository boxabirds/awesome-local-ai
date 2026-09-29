// Story 2, task 2.3: sticky.text unit tests (TC-13 to TC-17).
//
// Story 3 depends on `applyTextDiff` emitting a *minimal* diff: a full
// replace would destroy concurrent typing by other people (PRD
// live.concurrent_text), so the shape of the Yjs ops is asserted here.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

/** A Y.Text attached to a real document, starting empty. */
function newText(): Y.Text {
  const doc = new Y.Doc();
  const text = new Y.Text();
  doc.transact(() => {
    doc.getMap('root').set('text', text);
  }, LOCAL_ORIGIN);
  return text;
}

/** Capture the Y.Text delta events a mutation emits. */
function captureDeltas(text: Y.Text, fn: () => void): Array<Array<Record<string, unknown>>> {
  const events: Array<Array<Record<string, unknown>>> = [];
  const handler = (event: Y.YTextEvent): void => {
    events.push(event.delta as Array<Record<string, unknown>>);
  };
  text.observe(handler);
  try {
    fn();
  } finally {
    text.unobserve(handler);
  }
  return events;
}

// A 1,200-character English paragraph (not repeated single characters,
// which would exercise no realistic edit boundary).
const PROSE: string = [
  'The workshop started with a simple question about how the team wants to',
  'ship the new onboarding flow this quarter. People gathered around the',
  'whiteboard and added notes about activation, pricing, support load, and',
  'the open questions around the mobile experience. As the discussion grew,',
  'colours appeared to group related ideas, and a few notes were moved next',
  'to each other to show dependencies. By the end of the hour the board told',
  'a coherent story about what matters most, what needs a decision, and what',
  'can wait until the next sprint when the team has more context and fewer',
  'unknowns to resolve together in front of the customer interview notes.',
  'Everyone left with a short list of follow-ups: a prototype for the empty',
  'state, a draft of the pricing table, a support runbook outline, and a plan',
  'to replay the customer interview findings in the next design review so the',
  'whole group can challenge the assumptions before any of them hardens into',
  'a requirement that is expensive to change later in the quarter.',
].join(' ');

describe('sticky.text: applyTextDiff (TC-13)', () => {
  it('insert in the middle is a single insert op at the right index', () => {
    const text = newText();
    text.insert(0, 'abc');
    const deltas = captureDeltas(text, () => applyTextDiff(text, 'abXc', LOCAL_ORIGIN));

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(text.toString()).toBe('abXc');
  });

  it('pure deletion in the middle is a single delete op', () => {
    const text = newText();
    text.insert(0, 'abXc');
    const deltas = captureDeltas(text, () => applyTextDiff(text, 'abc', LOCAL_ORIGIN));

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { delete: 1 }]);
    expect(text.toString()).toBe('abc');
  });

  it('replacing a selection keeps the common prefix and suffix', () => {
    const text = newText();
    text.insert(0, 'hello world');
    const deltas = captureDeltas(text, () => applyTextDiff(text, 'hello earth', LOCAL_ORIGIN));

    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([
      { retain: 6 },
      { delete: 5 },
      { insert: 'earth' },
    ]);
    expect(text.toString()).toBe('hello earth');
  });

  it('emoji surrogate pairs are kept intact', () => {
    const text = newText();
    const deltas = captureDeltas(text, () =>
      applyTextDiff(text, 'a👍b', LOCAL_ORIGIN),
    );
    expect(text.toString()).toBe('a👍b');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ insert: 'a👍b' }]);

    const deltas2 = captureDeltas(text, () => applyTextDiff(text, 'abc😀', LOCAL_ORIGIN));
    expect(text.toString()).toBe('abc😀');
    expect(deltas2).toHaveLength(1);
    // 'a👍b' -> 'abc😀': keep 'a', drop the old emoji and 'b', insert 'bc😀'.
    expect(deltas2[0]).toEqual([{ retain: 1 }, { delete: 3 }, { insert: 'bc😀' }]);
  });

  it('identical text emits no ops and no transaction', () => {
    const text = newText();
    text.insert(0, 'same');
    const deltas = captureDeltas(text, () => applyTextDiff(text, 'same', LOCAL_ORIGIN));
    expect(deltas).toHaveLength(0);
  });
});

describe('sticky.text: clampToLimit (TC-14 to TC-16)', () => {
  it('TC-14 pasting 1,200 chars into an empty note keeps exactly 1,000', () => {
    const longText = PROSE + ' '.repeat(PROSE.length);
    expect(longText.length).toBeGreaterThanOrEqual(STICKY_TEXT_MAX_CHARS + 200);
    const clamped = clampToLimit(longText);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(longText.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 999 + 1 is accepted (boundary)', () => {
    const atLimit = PROSE.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(atLimit.length).toBe(STICKY_TEXT_MAX_CHARS - 1);
    const clamped = clampToLimit(atLimit + 'x');
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 1,000 + 1 is rejected, still 1,000 (negative boundary)', () => {
    const atLimit = PROSE.slice(0, STICKY_TEXT_MAX_CHARS);
    expect(atLimit.length).toBe(STICKY_TEXT_MAX_CHARS);
    const clamped = clampToLimit(atLimit + 'x');
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(atLimit);
  });
});

describe('sticky.text: counterVisible (TC-17)', () => {
  it('shows only when the remaining capacity is at or below the threshold', () => {
    // Remaining 51 / 50 / 49 -> false / true / true.
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });
});
