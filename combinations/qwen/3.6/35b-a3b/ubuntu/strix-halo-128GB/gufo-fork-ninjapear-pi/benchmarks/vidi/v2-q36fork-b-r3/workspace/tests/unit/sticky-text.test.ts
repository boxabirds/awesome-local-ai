import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '@client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '@shared/config';

// ─── Fixtures: realistic English text ─────────────────────────────────────

const SHORT = 'Faster onboarding';
const MULTI_LINE = `Team retrospective notes:

What went well:
- Improved CI pipeline speed
- Better code reviews
- Clearer documentation`;

const LONG_PROSE =
  'The morning sun cast long shadows across the quiet village as Emma walked along the cobblestone path toward the market square. She carried a woven basket filled with fresh bread from the bakery just down the street, its warm aroma mingling with the scent of blooming lavender that drifted from the cottage gardens lining her route. The villagers were already gathering for the weekly farmers market, their voices creating a gentle hum that grew louder with each step. Children chased each other between stalls displaying bright produce and handcrafted goods while older residents haggled good-naturedly over the price of locally grown tomatoes and freshly harvested honey. In the centre of the square stood an old stone fountain carved in the shape of a deer, its water still clear despite decades of use. This was the heart of their community, a place where stories were shared, friendships deepened, and new memories began every single day.';

// Extend to make a 1000+ char string for boundary testing
function makeLongText(targetLen: number): string {
  let result = LONG_PROSE;
  while (result.length < targetLen) {
    result += LONG_PROSE + ' ';
  }
  return result.slice(0, targetLen);
}

// ─── TC-13: applyTextDiff minimal diff ────────────────────────────────────

describe('TC-13: applyTextDiff minimal insert', () => {
  it("inserts 'X' at index 2 in 'abc' → 'abXc'", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'abc');

    applyTextDiff(ytext, 'abXc', {});
    expect(ytext.toString()).toBe('abXc');
  });

  it('pure deletion in middle', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'abcde');

    applyTextDiff(ytext, 'ade', {});
    expect(ytext.toString()).toBe('ade');
  });

  it('replacement of selection', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'hello world');

    applyTextDiff(ytext, 'hello earth', {});
    expect(ytext.toString()).toBe('hello earth');
  });

  it('emoji surrogate pairs kept intact', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, '😀🎉');

    // Insert emoji after the existing ones
    applyTextDiff(ytext, '😀🎉🚀', {});
    expect(ytext.toString()).toBe('😀🎉🚀');
  });

  it('empty to empty is no-op', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, '');

    applyTextDiff(ytext, '', {});
    expect(ytext.toString()).toBe('');
  });
});

// ─── TC-14: paste 1,200 chars into empty → 1,000 kept ───────────────────

describe('TC-14: clampToLimit 1,200 chars', () => {
  it('pasting 1,200 chars keeps exactly 1,000', () => {
    const long1200 = makeLongText(1200);
    const clipped = clampToLimit(long1200);
    expect(clipped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clipped).toBe(makeLongText(1000));
  });
});

// ─── TC-15: 999 + 1 → 1,000 accepted ─────────────────────────────────────

describe('TC-15: 999 + 1 char boundary', () => {
  it('999 char text + 1 char = 1000 accepted', () => {
    const text999 = makeLongText(999);
    const result = clampToLimit(text999 + 'x');
    expect(result.length).toBe(1000);
  });
});

// ─── TC-16: 1,000 + 1 rejected ──────────────────────────────────────────

describe('TC-16: 1,000 char limit negative boundary', () => {
  it('1,000 char text + 1 char stays at 1,000', () => {
    const text1000 = makeLongText(1000);
    const result = clampToLimit(text1000 + 'extra');
    expect(result.length).toBe(1000);
    expect(result).toBe(text1000);
  });
});

// ─── TC-17: counterVisible boundary values ───────────────────────────────

describe('TC-17: counterVisible threshold', () => {
  it('949 chars → counter not visible (remaining = 51)', () => {
    expect(counterVisible(949)).toBe(false);
  });

  it('950 chars → counter visible (remaining = 50)', () => {
    expect(counterVisible(950)).toBe(true);
  });

  it('951 chars → counter visible (remaining = 49)', () => {
    expect(counterVisible(951)).toBe(true);
  });

  it('0 chars → counter not visible', () => {
    expect(counterVisible(0)).toBe(false);
  });

  it('exactly at max → counter visible', () => {
    expect(counterVisible(1000)).toBe(true);
  });
});
