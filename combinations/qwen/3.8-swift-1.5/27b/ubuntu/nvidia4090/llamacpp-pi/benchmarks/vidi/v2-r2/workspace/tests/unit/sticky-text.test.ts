import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../src/shared/config';

/** Realistic English fixtures (not repeated single characters). */
const WORDS =
  'the quick brown fox jumps over the lazy dog near the river bank where the old mill still turns in the morning light';
function prose(chars: number): string {
  // Repeat the word list with spaces, then cut to exactly `chars`.
  let out = '';
  while (out.length < chars) {
    out += (out.length > 0 ? ' ' : '') + WORDS;
  }
  return out.slice(0, chars);
}

interface RecordedOp {
  type: 'insert' | 'delete';
  index: number;
  len: number;
}

/** Creates a Y.Text bound to a real Y.Doc (as in production, where every
 * Y.Text lives in the board doc). */
function makeText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText('text');
  if (initial) t.insert(0, initial);
  return t;
}

/** Records Y.Text delta events as {type, index, len} ops. */
function recordDeltas(ytext: Y.Text) {
  const ops: RecordedOp[] = [];
  const handler = (event: Y.YTextEvent) => {
    const delta = event.delta;
    let index = 0;
    for (const op of delta) {
      if (typeof op.insert === 'string') {
        ops.push({ type: 'insert', index, len: op.insert.length });
        index += op.insert.length;
      } else if (typeof op.delete === 'number') {
        ops.push({ type: 'delete', index, len: op.delete });
      } else if (typeof op.retain === 'number') {
        index += op.retain;
      }
    }
  };
  ytext.observe(handler);
  return {
    ops,
    done: () => ytext.unobserve(handler),
  };
}

describe('sticky.text: applyTextDiff (TC-13)', () => {
  it("TC-13: 'abc' → 'abXc' is a single insert of 'X' at index 2 (not delete-all + insert-all)", () => {
    const ytext = makeText('abc');
    const { ops, done } = recordDeltas(ytext);
    applyTextDiff(ytext, 'abXc', 'test');
    done();
    expect(ytext.toString()).toBe('abXc');
    expect(ops).toEqual([{ type: 'insert', index: 2, len: 1 }]);
  });

  it('pure deletion in the middle is a single delete', () => {
    const ytext = makeText('abcdef');
    const { ops, done } = recordDeltas(ytext);
    applyTextDiff(ytext, 'acdef', 'test');
    done();
    expect(ytext.toString()).toBe('acdef');
    expect(ops).toEqual([{ type: 'delete', index: 1, len: 1 }]);
  });

  it('replacement of a selection is one delete + one insert', () => {
    const ytext = makeText('hello world');
    const { ops, done } = recordDeltas(ytext);
    applyTextDiff(ytext, 'hello there', 'test');
    done();
    expect(ytext.toString()).toBe('hello there');
    expect(ops).toEqual([
      { type: 'delete', index: 6, len: 5 },
      { type: 'insert', index: 6, len: 5 },
    ]);
  });

  it('emoji surrogate pairs are kept intact', () => {
    // Deleting the emoji from the start must not leave a lone surrogate.
    const ytext = makeText('💩abc');
    applyTextDiff(ytext, 'abc', 'test');
    expect(ytext.toString()).toBe('abc');
    expect([...ytext.toString()]).toEqual(['a', 'b', 'c']);

    // Deleting the emoji from the end.
    const ytext2 = makeText('abc💩');
    applyTextDiff(ytext2, 'abc', 'test');
    expect(ytext2.toString()).toBe('abc');

    // Inserting an emoji in the middle keeps pairs intact.
    const ytext3 = makeText('ab');
    applyTextDiff(ytext3, 'a💩b', 'test');
    expect(ytext3.toString()).toBe('a💩b');
    expect([...ytext3.toString()]).toEqual(['a', '💩', 'b']);

    // Repetitive emoji: deleting one of two identical emojis keeps pairs intact.
    const ytext4 = makeText('💩💩');
    applyTextDiff(ytext4, '💩', 'test');
    expect([...ytext4.toString()]).toEqual(['💩']);

    // Repetitive emoji with surrounding text.
    const ytext5 = makeText('a💩💩b');
    applyTextDiff(ytext5, 'a💩b', 'test');
    expect([...ytext5.toString()]).toEqual(['a', '💩', 'b']);
  });

  it('no-op change emits nothing', () => {
    const ytext = makeText('abc');
    const { ops, done } = recordDeltas(ytext);
    applyTextDiff(ytext, 'abc', 'test');
    done();
    expect(ops).toEqual([]);
  });
});

describe('sticky.text: clampToLimit (TC-14, TC-15, TC-16)', () => {
  it(`TC-14: pasting 1,200 chars into empty keeps exactly ${STICKY_TEXT_MAX_CHARS}`, () => {
    const pasted = prose(1200);
    const kept = clampToLimit(pasted);
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it(`TC-15: 999 + 1 → ${STICKY_TEXT_MAX_CHARS} accepted (boundary)`, () => {
    const at999 = prose(999);
    const result = clampToLimit(at999 + 'x');
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(at999 + 'x');
  });

  it(`TC-16: ${STICKY_TEXT_MAX_CHARS} + 1 → rejected, still ${STICKY_TEXT_MAX_CHARS} (boundary)`, () => {
    const at1000 = prose(STICKY_TEXT_MAX_CHARS);
    const result = clampToLimit(at1000 + 'x');
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(at1000);
  });

  it('under the limit is untouched', () => {
    const short = prose(42);
    expect(clampToLimit(short)).toBe(short);
  });

  it('respects a custom max', () => {
    expect(clampToLimit('abcdef', 4)).toBe('abcd');
  });
});

describe('sticky.text: counterVisible (TC-17)', () => {
  it(`TC-17: 949 / 950 / 951 chars → false / true / true (threshold ${STICKY_COUNTER_THRESHOLD_CHARS})`, () => {
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it('empty note → false; at limit → true', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
