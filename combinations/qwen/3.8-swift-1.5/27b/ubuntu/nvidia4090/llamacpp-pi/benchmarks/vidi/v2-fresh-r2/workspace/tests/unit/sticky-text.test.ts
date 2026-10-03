/**
 * Unit tests for sticky text logic (sticky.text contract).
 * TC-13 to TC-17.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';

describe('sticky.text', () => {
  // TC-13: applyTextDiff produces minimal diff
  describe('applyTextDiff', () => {
    function makeText(initial: string): { ytext: Y.Text; deltas: any[] } {
      const doc = new Y.Doc();
      const ytext = doc.getText('content');
      ytext.insert(0, initial);
      const deltas: any[] = [];
      ytext.observe((event: any) => {
        deltas.push(...event.delta);
      });
      return { ytext, deltas };
    }

    /** Filter out retain entries, keeping only actual mutations. */
    function mutations(deltas: any[]): any[] {
      return deltas.filter((d) => d.retain === undefined);
    }

    it('TC-13a: insert in middle produces single insert, not delete+insert all', () => {
      const { ytext, deltas } = makeText('abc');

      applyTextDiff(ytext, 'abXc', 'test-origin');

      // Should have exactly one mutation: an insert of 'X'
      const muts = mutations(deltas);
      expect(muts).toHaveLength(1);
      expect(muts[0]).toEqual({ insert: 'X' });
      expect(ytext.toString()).toBe('abXc');
    });

    it('TC-13b: pure deletion in middle', () => {
      const { ytext, deltas } = makeText('abcde');

      applyTextDiff(ytext, 'acde', 'test-origin');

      // Should delete 'b' at index 1
      const muts = mutations(deltas);
      expect(muts).toHaveLength(1);
      expect(muts[0]).toEqual({ delete: 1 });
      expect(ytext.toString()).toBe('acde');
    });

    it('TC-13c: replacement of a selection', () => {
      const { ytext, deltas } = makeText('hello world');

      applyTextDiff(ytext, 'hello earth', 'test-origin');

      // 'world' → 'earth': common prefix 'hello ', then delete 'world' (5), insert 'earth' (5)
      // 'world' vs 'earth': no common suffix
      // So: delete 5, insert 'earth'
      expect(ytext.toString()).toBe('hello earth');
      // Should be at most 2 mutations (one delete, one insert)
      const muts = mutations(deltas);
      expect(muts.length).toBeLessThanOrEqual(2);
    });

    it('TC-13d: emoji surrogate pairs kept intact', () => {
      const { ytext, deltas } = makeText('hello');

      applyTextDiff(ytext, 'hello🌍world', 'test-origin');

      expect(ytext.toString()).toBe('hello🌍world');
      // Single insert mutation of the emoji + 'world'
      const muts = mutations(deltas);
      expect(muts).toHaveLength(1);
      expect(muts[0].insert).toBe('🌍world');
    });
  });

  // TC-14: paste of 1,200 chars into empty → 1,000 kept
  it('TC-14: clampToLimit truncates 1200 chars to 1000', () => {
    // Use realistic English text
    const word = 'The quick brown fox jumps over the lazy dog. ';
    const long = word.repeat(40).slice(0, 1200);
    expect(long.length).toBe(1200);

    const result = clampToLimit(long);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(long.slice(0, 1000));
  });

  // TC-15: 999 + 1 → 1,000 accepted
  it('TC-15: clampToLimit accepts exactly 1000 chars', () => {
    const text = 'A'.repeat(999) + 'B';
    expect(text.length).toBe(1000);
    const result = clampToLimit(text);
    expect(result).toBe(text);
    expect(result.length).toBe(1000);
  });

  // TC-16: 1,000 + 1 → rejected, still 1,000
  it('TC-16: clampToLimit rejects 1001st character', () => {
    const text = 'A'.repeat(1000) + 'B';
    expect(text.length).toBe(1001);
    const result = clampToLimit(text);
    expect(result.length).toBe(1000);
    expect(result).toBe('A'.repeat(1000));
  });

  // TC-17: counterVisible at 949 / 950 / 951 chars
  it('TC-17: counterVisible boundary at STICKY_COUNTER_THRESHOLD_CHARS', () => {
    // remaining = 1000 - length
    // 949 chars → remaining 51 → false
    // 950 chars → remaining 50 → true
    // 951 chars → remaining 49 → true
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('counterVisible: 0 chars remaining → true', () => {
    expect(counterVisible(1000)).toBe(true);
  });

  it('counterVisible: well below threshold → false', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(500)).toBe(false);
  });
});
