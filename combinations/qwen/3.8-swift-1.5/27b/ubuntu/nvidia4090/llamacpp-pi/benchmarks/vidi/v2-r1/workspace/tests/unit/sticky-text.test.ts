import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';

// We'll test the pure functions once they're implemented
// For now, import from the module that will contain them
import { clampToLimit, applyTextDiff, counterVisible } from '@client/objects/StickyText';

// Realistic English text fixtures
const SHORT_TEXT = 'Faster onboarding';

// 1000 char paragraph of English prose
const LONG_TEXT = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! The five boxing wizards jump quickly. Jackdaws love my big sphinx of quartz. The jay, pik, and dex quiz; the whifflums study big art. A mad boxer shot a quick, jumping few: "Gloves," said the wizard, "box a quiet thief." The quick brown fox. ' +
  'In the realm of software engineering, the art of crafting elegant solutions requires both creativity and discipline. Developers must balance the immediate needs of their teams with the long-term health of the codebase. Every decision carries consequences that ripple through the system, affecting performance, maintainability, and the experience of those who will inherit the code. The best engineers understand that software is not merely a collection of functions and classes, but a living document that communicates intent and constraints to its readers. They write code that speaks clearly, that reveals its purpose at every level of abstraction, and that resists the pull of premature optimization. They know that the best code is not the cleverest code, but the code that the next person will understand without having to ask. This is the quiet art of software engineering: making the complex seem simple, the intricate seem obvious, and the impossible seem inevitable.';
// Pad to exactly 1000 chars
function makeTextOfLength(n: number): string {
  const base = LONG_TEXT;
  if (base.length >= n) return base.slice(0, n);
  let result = base;
  while (result.length < n) {
    result += ' More text to pad the length for testing purposes. ';
  }
  return result.slice(0, n);
}

describe('sticky.text', () => {
  // TC-13: applyTextDiff 'abc' → 'abXc' produces a single insert of 'X' at index 2
  describe('applyTextDiff', () => {
    function makeBoundText(initial: string): { doc: Y.Doc; ytext: Y.Text } {
      const doc = new Y.Doc();
      const ytext = doc.getText('text');
      if (initial) {
        doc.transact(() => {
          ytext.insert(0, initial);
        });
      }
      return { doc, ytext };
    }

    it('TC-13a: single character insertion in middle produces minimal diff', () => {
      const { ytext } = makeBoundText('abc');
      
      const deltas: any[] = [];
      ytext.observe(event => {
        for (const delta of event.delta) {
          deltas.push(delta);
        }
      });
      
      applyTextDiff(ytext, 'abXc', 'test-origin');
      
      // Should be retain(2) + insert('X') — a minimal diff, not delete-all + insert-all
      expect(deltas).toHaveLength(2);
      expect(deltas[0].retain).toBe(2);
      expect(deltas[1].insert).toBe('X');
      expect(ytext.toString()).toBe('abXc');
    });

    it('TC-13b: pure deletion in middle produces minimal diff', () => {
      const { ytext } = makeBoundText('abcde');
      
      const deltas: any[] = [];
      ytext.observe(event => {
        for (const delta of event.delta) {
          deltas.push(delta);
        }
      });
      
      applyTextDiff(ytext, 'abde', 'test-origin');
      
      // Should be retain(2) + delete(1) — a minimal diff, not delete-all + insert-all
      expect(deltas).toHaveLength(2);
      expect(deltas[0].retain).toBe(2);
      expect(deltas[1].delete).toBe(1);
      expect(ytext.toString()).toBe('abde');
    });

    it('TC-13c: replacement of a selection produces minimal diff', () => {
      const { ytext } = makeBoundText('hello world');
      
      applyTextDiff(ytext, 'hello earth', 'test-origin');
      
      expect(ytext.toString()).toBe('hello earth');
    });

    it('TC-13d: emoji surrogate pairs kept intact', () => {
      const { ytext } = makeBoundText('ab');
      
      applyTextDiff(ytext, 'ab💩c', 'test-origin');
      
      expect(ytext.toString()).toBe('ab💩c');
    });
  });

  // TC-14: paste of 1,200 chars into empty → 1,000 kept
  describe('clampToLimit', () => {
    it('TC-14: paste of 1,200 chars into empty keeps 1,000', () => {
      const longText = makeTextOfLength(1200);
      const result = clampToLimit(longText);
      expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
      expect(result).toBe(longText.slice(0, STICKY_TEXT_MAX_CHARS));
    });

    it('TC-15: 999 + 1 → 1,000 accepted (boundary)', () => {
      const text999 = makeTextOfLength(999);
      const result = clampToLimit(text999 + 'a');
      expect(result).toHaveLength(1000);
    });

    it('TC-16: 1,000 + 1 → rejected, still 1,000', () => {
      const text1000 = makeTextOfLength(1000);
      const result = clampToLimit(text1000 + 'a');
      expect(result).toHaveLength(1000);
      expect(result).toBe(text1000);
    });

    it('short text passes through unchanged', () => {
      expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
      expect(clampToLimit('')).toBe('');
    });
  });

  // TC-17: counterVisible at 949 / 950 / 951 chars
  describe('counterVisible', () => {
    it('TC-17a: 949 chars → false (remaining 51 > 50)', () => {
      expect(counterVisible(949)).toBe(false);
    });

    it('TC-17b: 950 chars → true (remaining 50 <= 50)', () => {
      expect(counterVisible(950)).toBe(true);
    });

    it('TC-17c: 951 chars → true (remaining 49 <= 50)', () => {
      expect(counterVisible(951)).toBe(true);
    });

    it('1000 chars → true', () => {
      expect(counterVisible(1000)).toBe(true);
    });

    it('0 chars → false', () => {
      expect(counterVisible(0)).toBe(false);
    });
  });
});
