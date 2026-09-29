import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText.js';
import { LOCAL_ORIGIN } from '../../src/shared/board-model.js';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config.js';

/** A standalone Y.Text living in a real doc, so delta events are observable. */
function makeText(initial = ''): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (initial) doc.transact(() => ytext.insert(0, initial), LOCAL_ORIGIN);
  return { doc, ytext };
}

interface DeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

/** Collect every delta op the text observes during `fn`. */
function observeDelta(
  ytext: Y.Text,
  fn: () => void,
): { ops: DeltaOp[]; transactions: number } {
  const ops: DeltaOp[] = [];
  let transactions = 0;
  const handler = (event: Y.YTextEvent): void => {
    transactions += 1;
    for (const op of event.delta as unknown as DeltaOp[]) ops.push(op);
  };
  ytext.observe(handler);
  try {
    fn();
  } finally {
    ytext.unobserve(handler);
  }
  return { ops, transactions };
}

/** The insert index (leading retains) across the observed ops. */
function insertIndex(ops: DeltaOp[]): number {
  let index = 0;
  for (const op of ops) {
    if (op.retain !== undefined) index += op.retain;
    else break;
  }
  return index;
}

/** True when every high surrogate is followed by its low surrogate (no lone surrogate). */
const wellFormed = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
};

describe('applyTextDiff (TC-13)', () => {
  it('emits a single insert of the one new character, not delete-all + insert-all', () => {
    const { ytext } = makeText('abc');
    const { ops, transactions } = observeDelta(ytext, () => {
      applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    });

    expect(transactions).toBe(1);
    expect(ytext.toString()).toBe('abXc');
    // exactly one insert, no deletes
    const inserts = ops.filter((o) => o.insert !== undefined);
    const deletes = ops.filter((o) => o.delete !== undefined);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.insert).toBe('X');
    expect(deletes).toHaveLength(0);
    // it lands at index 2
    expect(insertIndex(ops)).toBe(2);
  });

  it('emits a single pure deletion in the middle', () => {
    const { ytext } = makeText('abcd');
    const { ops } = observeDelta(ytext, () => {
      applyTextDiff(ytext, 'acd', LOCAL_ORIGIN);
    });
    expect(ytext.toString()).toBe('acd');
    const deletes = ops.filter((o) => o.delete !== undefined);
    const inserts = ops.filter((o) => o.insert !== undefined);
    expect(inserts).toHaveLength(0);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.delete).toBe(1);
  });

  it('emits one delete and one insert for a replacement of a selection', () => {
    const { ytext } = makeText('abcd');
    const { ops, transactions } = observeDelta(ytext, () => {
      applyTextDiff(ytext, 'aXd', LOCAL_ORIGIN);
    });
    expect(transactions).toBe(1);
    expect(ytext.toString()).toBe('aXd');
    const deletes = ops.filter((o) => o.delete !== undefined);
    const inserts = ops.filter((o) => o.insert !== undefined);
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.insert).toBe('X');
  });

  it('inserts a surrogate pair whole and keeps the text well-formed', () => {
    const { ytext } = makeText('ab');
    const { ops } = observeDelta(ytext, () => {
      applyTextDiff(ytext, 'a\u{1F600}b', LOCAL_ORIGIN);
    });
    const inserts = ops.filter((o) => o.insert !== undefined);
    expect(inserts[0]!.insert).toBe('\u{1F600}');
    expect(ytext.toString()).toBe('a\u{1F600}b');
    expect(wellFormed(ytext.toString())).toBe(true);
  });

  it('deleting around an emoji never leaves a lone surrogate', () => {
    const { ytext } = makeText('\u{1F600}\u{1F600}');
    applyTextDiff(ytext, '\u{1F600}', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('\u{1F600}');
    expect(wellFormed(ytext.toString())).toBe(true);
  });

  it('produces no delta when the text already matches', () => {
    const { ytext } = makeText('same');
    const { transactions } = observeDelta(ytext, () => {
      applyTextDiff(ytext, 'same', LOCAL_ORIGIN);
    });
    expect(transactions).toBe(0);
  });
});

describe('clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14 keeps only the first 1,000 characters of a 1,200-char paste', () => {
    const pasted = 'x'.repeat(1200);
    const kept = clampToLimit(pasted);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 accepts the 1,000th character (boundary)', () => {
    const value = 'a'.repeat(999) + 'b'; // 1,000
    expect(clampToLimit(value)).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 rejects the 1,001st character (boundary)', () => {
    const value = 'a'.repeat(1000) + 'b'; // 1,001
    const kept = clampToLimit(value);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe('a'.repeat(1000));
  });

  it('never cuts a surrogate pair at the limit', () => {
    const value = 'a'.repeat(STICKY_TEXT_MAX_CHARS - 1) + '\u{1F600}';
    const kept = clampToLimit(value);
    expect(wellFormed(kept)).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
  });

  it('leaves text below the limit untouched', () => {
    expect(clampToLimit('hello')).toBe('hello');
  });
});

describe('counterVisible (TC-17)', () => {
  const remaining = (len: number): number => STICKY_TEXT_MAX_CHARS - len;

  it('hides the counter while more than the threshold remains', () => {
    expect(remaining(949)).toBe(STICKY_COUNTER_THRESHOLD_CHARS + 1);
    expect(counterVisible(949)).toBe(false);
  });

  it('shows the counter at exactly the threshold (boundary)', () => {
    expect(remaining(950)).toBe(STICKY_COUNTER_THRESHOLD_CHARS);
    expect(counterVisible(950)).toBe(true);
  });

  it('shows the counter once inside the threshold', () => {
    expect(remaining(951)).toBe(STICKY_COUNTER_THRESHOLD_CHARS - 1);
    expect(counterVisible(951)).toBe(true);
  });

  it('shows the counter at the very limit', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('hides the counter for an empty or short note', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(10)).toBe(false);
  });
});
