import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../src/shared/config';

// --- Realistic English text fixtures (not repeated single characters) ---
const SENTENCES = [
  'The team discussed how to make onboarding faster for new members.',
  'We agreed to reduce the number of steps in the first run experience.',
  'A clearer welcome screen should help people find their way quickly.',
  'Feedback from last week pointed to too many options on the home board.',
  'Simplifying the toolbar would let new users focus on the important tools.',
  'We will prototype a smaller set of tools and measure the impact next sprint.',
];

/** Build realistic English prose of exactly `length` characters. */
function proseOf(length: number): string {
  let out = '';
  let i = 0;
  while (out.length < length) {
    out += (out.length > 0 ? ' ' : '') + SENTENCES[i % SENTENCES.length];
    i++;
  }
  return out.slice(0, length);
}

const SHORT_PHRASE = 'Faster onboarding';
const MULTILINE_RETRO =
  'What went well: we shipped the new onboarding flow.\n' +
  'What hurt: the review queue grew faster than we could clear it.\n' +
  'Action: add a second reviewer on call each week starting Monday.';

// --- Delta capture helpers ---
type DeltaOp = { retain?: number; insert?: string; delete?: number };

/** Create a Y.Text inside a fresh doc (required for reading) with optional initial content. */
function makeText(initial = ''): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  if (initial) t.insert(0, initial);
  return t;
}

function captureDeltas(ytext: Y.Text, fn: () => void): DeltaOp[][] {
  const deltas: DeltaOp[][] = [];
  const handler = (event: Y.YTextEvent) => {
    deltas.push(event.delta as DeltaOp[]);
  };
  ytext.observe(handler);
  fn();
  ytext.unobserve(handler);
  return deltas;
}
function summarize(deltas: DeltaOp[][]): { inserted: string; deleted: number } {
  let inserted = '';
  let deleted = 0;
  for (const delta of deltas) {
    for (const op of delta) {
      if (typeof op.insert === 'string') inserted += op.insert;
      if (typeof op.delete === 'number') deleted += op.delete;
    }
  }
  return { inserted, deleted };
}

describe('sticky.text (pure text logic)', () => {
  // TC-13: minimal diff, not delete-all + insert-all
  describe('TC-13: applyTextDiff produces a minimal change', () => {
    it('insert: abc -> abXc is a single insert of X, no delete', () => {
      const ytext = makeText('abc');
      const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'abXc', 't'));
      expect(ytext.toString()).toBe('abXc');
      const { inserted, deleted } = summarize(deltas);
      expect(inserted).toBe('X');
      expect(deleted).toBe(0);
    });

    it('pure deletion in the middle: abcd -> acd deletes 1, inserts nothing', () => {
      const ytext = makeText('abcd');
      const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'acd', 't'));
      expect(ytext.toString()).toBe('acd');
      const { inserted, deleted } = summarize(deltas);
      expect(inserted).toBe('');
      expect(deleted).toBe(1);
    });

    it('replacement of a selection: "hello world" -> "hello there" is not delete-all+insert-all', () => {
      const ytext = makeText('hello world');
      const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'hello there', 't'));
      expect(ytext.toString()).toBe('hello there');
      const { inserted, deleted } = summarize(deltas);
      // Minimal: replace only "world" with "there".
      expect(inserted).toBe('there');
      expect(deleted).toBe(5);
      // Definitely not a full replace (which would delete 11 / insert 11).
      expect(deleted).not.toBe(11);
      expect(inserted.length).not.toBe(11);
    });

    it('emoji surrogate pairs are kept intact: a\\u{1F600}b -> a\\u{1F600}c', () => {
      const ytext = makeText('a\u{1F600}b');
      const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'a\u{1F600}c', 't'));
      expect(ytext.toString()).toBe('a\u{1F600}c');
      const { inserted, deleted } = summarize(deltas);
      expect(inserted).toBe('c');
      expect(deleted).toBe(1);
    });

    it('no-op: identical text emits no delta', () => {
      const ytext = makeText(SHORT_PHRASE);
      const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, SHORT_PHRASE, 't'));
      expect(deltas).toHaveLength(0);
      expect(ytext.toString()).toBe(SHORT_PHRASE);
    });
  });

  // TC-14: paste of 1,200 chars into empty -> 1,000 kept
  it('TC-14: pasting 1,200 chars into an empty note keeps exactly 1,000', () => {
    const ytext = makeText();
    const pasted = proseOf(1200);
    applyTextDiff(ytext, clampToLimit(pasted), 't');
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  // TC-15: 999 + 1 -> 1,000 accepted (boundary)
  it('TC-15: 999 chars + 1 char -> 1,000 accepted', () => {
    const ytext = makeText(proseOf(999));
    const base = proseOf(999);
    applyTextDiff(ytext, clampToLimit(base + 'X'), 't');
    expect(ytext.toString()).toHaveLength(1000);
    expect(ytext.toString()).toBe(base + 'X');
  });

  // TC-16: 1,000 + 1 -> rejected, still 1,000 (negative/boundary)
  it('TC-16: 1,000 chars + 1 char -> still 1,000', () => {
    const ytext = makeText(proseOf(1000));
    const base = proseOf(1000);
    applyTextDiff(ytext, clampToLimit(base + 'X'), 't');
    expect(ytext.toString()).toHaveLength(1000);
    expect(ytext.toString()).toBe(base);
  });

  // TC-17: counterVisible boundary at STICKY_COUNTER_THRESHOLD_CHARS
  it('TC-17: counterVisible at 949 / 950 / 951 chars -> false / true / true', () => {
    expect(STICKY_TEXT_MAX_CHARS - 949).toBe(STICKY_COUNTER_THRESHOLD_CHARS + 1); // 51 remaining
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  // clampToLimit direct behaviour
  describe('clampToLimit', () => {
    it('returns short text unchanged', () => {
      expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    });
    it('returns the 1,000-char text unchanged at the boundary', () => {
      const at = proseOf(1000);
      expect(clampToLimit(at)).toBe(at);
    });
    it('truncates over-limit text to the default max', () => {
      const over = proseOf(1500);
      expect(clampToLimit(over)).toHaveLength(1000);
    });
    it('honours a custom max', () => {
      const over = proseOf(100);
      expect(clampToLimit(over, 10)).toHaveLength(10);
      expect(clampToLimit(over, 10)).toBe(over.slice(0, 10));
    });
  });

  // Multiline fixture is usable (sanity for the fixtures)
  it('fixtures: multiline retro item keeps its newlines', () => {
    const ytext = makeText();
    applyTextDiff(ytext, clampToLimit(MULTILINE_RETRO), 't');
    expect(ytext.toString()).toBe(MULTILINE_RETRO);
    expect(ytext.toString()).toContain('\n');
  });
});
