/**
 * Story 2, sticky.text pure logic (design TC-13 to TC-17).
 *
 * Unit tests for clampToLimit, applyTextDiff and counterVisible against a
 * real Y.Text. applyTextDiff must produce the minimal change (common prefix
 * + common suffix), not a full replace, so concurrent typing by others
 * (story 3) is never destroyed.
 *
 * Fixtures are realistic English prose, never repeated single characters.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

/** A sentence of English prose; repeated and sliced to reach exact lengths. */
const SENTENCE =
  'The onboarding flow lost new users at the integration step, where the form asked for details they had not agreed to share yet. ';

function proseOfLength(n: number): string {
  let s = '';
  while (s.length < n) {
    s += SENTENCE;
  }
  return s.slice(0, n);
}

/** A Y.Text bound to a real Y.Doc (Yjs requires a doc for transactions). */
function makeYText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('text');
  ytext.insert(0, initial);
  return ytext;
}

type DeltaOp = Record<string, unknown>;

/**
 * Summarises Y.Text delta ops into retained/inserted/deleted amounts.
 * Yjs reports a delta as a sequence of chunks from index 0 to the last
 * change: `{retain:n}`, `{insert:str}`, `{delete:n}` (or legacy
 * `{retain:n,delete:true}`). The unchanged trailing suffix after the last
 * change is NOT included, so `retained` is the content kept *before* the
 * change, not the whole unchanged remainder.
 */
function summarize(deltas: DeltaOp[][]): { retained: number; inserted: string; deleted: number } {
  let retained = 0;
  let deleted = 0;
  let inserted = '';
  for (const delta of deltas) {
    for (const op of delta) {
      const retain = typeof op.retain === 'number' ? op.retain : 0;
      if (op.delete === true) {
        deleted += retain;
      } else if (typeof op.delete === 'number') {
        deleted += op.delete;
      } else {
        retained += retain;
      }
      if (typeof op.insert === 'string') {
        inserted += op.insert;
      }
    }
  }
  return { retained, inserted, deleted };
}

/** Watches a Y.Text and collects its delta events. */
function watchDeltas(ytext: Y.Text): {
  summary: () => { retained: number; inserted: string; deleted: number };
} {
  const deltas: DeltaOp[][] = [];
  const cb = (event: { delta: DeltaOp[] }): void => {
    deltas.push(event.delta);
  };
  ytext.observe(cb);
  return {
    summary: () => summarize(deltas),
  };
}

/** True when the string contains a lone (unpaired) UTF-16 surrogate. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // high surrogate: next must be a low surrogate
      if (i + 1 >= s.length || !(s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff)) {
        return true;
      }
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // low surrogate without a preceding high surrogate
      return true;
    }
  }
  return false;
}

describe('sticky.text: applyTextDiff (TC-13)', () => {
  it('TC-13: abc -> abXc is a single insert of X at index 2, not delete-all+insert-all', () => {
    const ytext = makeYText('abc');
    const watch = watchDeltas(ytext);

    applyTextDiff(ytext, 'abXc', 'test');

    expect(ytext.toString()).toBe('abXc');
    const { retained, inserted, deleted } = watch.summary();
    // Exactly the inserted character, nothing deleted, 2 chars retained before it.
    expect(inserted).toBe('X');
    expect(deleted).toBe(0);
    expect(retained).toBe(2);
  });

  it('a pure deletion in the middle deletes only the deleted span', () => {
    const ytext = makeYText('abcdef');
    const watch = watchDeltas(ytext);

    applyTextDiff(ytext, 'abef', 'test');

    expect(ytext.toString()).toBe('abef');
    const { retained, inserted, deleted } = watch.summary();
    expect(inserted).toBe('');
    expect(deleted).toBe(2); // 'cd' deleted
    expect(retained).toBe(2); // 'ab' kept before the change point
  });

  it('a replacement of a selection deletes one char and inserts one char', () => {
    const ytext = makeYText('abc');
    const watch = watchDeltas(ytext);

    applyTextDiff(ytext, 'axc', 'test');

    expect(ytext.toString()).toBe('axc');
    const { inserted, deleted } = watch.summary();
    expect(inserted).toBe('x');
    expect(deleted).toBe(1); // 'b'
  });

  it('emoji surrogate pairs are kept intact across a replacement', () => {
    const ytext = makeYText('a😀b');
    const watch = watchDeltas(ytext);

    applyTextDiff(ytext, 'a🙂b', 'test');

    expect(ytext.toString()).toBe('a🙂b');
    expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    const { inserted, deleted } = watch.summary();
    // One emoji out (2 code units), one emoji in (2 code units); nothing split.
    expect(inserted.length).toBe(2);
    expect(deleted).toBe(2);
  });

  it('an insert at the end retains everything and deletes nothing', () => {
    const ytext = makeYText('ab');
    const watch = watchDeltas(ytext);

    applyTextDiff(ytext, 'abc', 'test');

    expect(ytext.toString()).toBe('abc');
    const { retained, inserted, deleted } = watch.summary();
    expect(inserted).toBe('c');
    expect(deleted).toBe(0);
    expect(retained).toBe(2);
  });

  it('a no-op diff (same text) emits no change', () => {
    const ytext = makeYText('same');
    const watch = watchDeltas(ytext);

    applyTextDiff(ytext, 'same', 'test');

    expect(ytext.toString()).toBe('same');
    const { retained, inserted, deleted } = watch.summary();
    expect(inserted).toBe('');
    expect(deleted).toBe(0);
    expect(retained).toBe(0);
  });
});

describe('sticky.text: clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14: a paste of 1,200 chars into empty keeps exactly the first 1,000', () => {
    const pasted = proseOfLength(1200);
    const kept = clampToLimit(pasted);
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    // The default max is STICKY_TEXT_MAX_CHARS.
    expect(clampToLimit(pasted, STICKY_TEXT_MAX_CHARS)).toBe(kept);
  });

  it('TC-15: 999 chars + 1 is accepted (boundary at exactly 1,000)', () => {
    const base = proseOfLength(999);
    const next = base + 'x';
    expect(next.length).toBe(1000);
    const kept = clampToLimit(next);
    expect(kept).toBe(next);
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16: 1,000 chars + 1 is rejected (still 1,000)', () => {
    const atLimit = proseOfLength(1000);
    const next = atLimit + 'x';
    expect(next.length).toBe(1001);
    const kept = clampToLimit(next);
    expect(kept).toBe(atLimit);
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('an explicit max shorter than the content clamps to that max', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('ab', 5)).toBe('ab'); // below max: unchanged
  });
});

describe('sticky.text: counterVisible (TC-17)', () => {
  it('TC-17: counter appears at the STICKY_COUNTER_THRESHOLD_CHARS boundary', () => {
    // remaining = STICKY_TEXT_MAX_CHARS - length; visible when remaining <= threshold
    const at = (length: number): number => STICKY_TEXT_MAX_CHARS - length;

    // 949 chars -> 51 remaining -> not visible (51 > 50)
    expect(counterVisible(949)).toBe(false);
    // 950 chars -> 50 remaining -> visible (50 <= 50)
    expect(counterVisible(950)).toBe(true);
    // 951 chars -> 49 remaining -> visible
    expect(counterVisible(951)).toBe(true);

    // sanity: the boundary length is exactly max - threshold
    const boundary = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    expect(counterVisible(boundary - 1)).toBe(false);
    expect(counterVisible(boundary)).toBe(true);
    // at the limit it is visible
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(at(boundary)).toBe(STICKY_COUNTER_THRESHOLD_CHARS);
  });
});
