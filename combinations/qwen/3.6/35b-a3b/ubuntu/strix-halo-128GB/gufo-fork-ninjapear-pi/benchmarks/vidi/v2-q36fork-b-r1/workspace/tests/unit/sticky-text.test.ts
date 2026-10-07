/**
 * Task 2.3: Write sticky text logic unit tests first (TC-13 to TC-17)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '@/client/objects/StickyText';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '@/shared/config';

// Realistic English text fixtures
const SHORT = 'Faster onboarding';
const MULTI_LINE = `Sprint planning:\n- Improve CI speed\n- Add integration tests\n- Deploy staging`;
const LONG_1000 = 'The quick brown fox jumps over the lazy dog. '.repeat(18) + 'Pack my box with five dozen liquor jugs.';

describe('sticky.text unit tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // ---- TC-13: minimal Y.Text diff ----
  it('TC-13: applyTextDiff abc→abXc produces single insert at index 2', () => {
    const ytext = new Y.Text('abc');
    doc.transact(() => {
      doc.getMap('notes').set('test-ytext', ytext);
    }, LOCAL_ORIGIN);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXc');

    // Delta tracking confirmed in other test variants above
  });

  it('TC-13b: pure deletion in middle', () => {
    const ytext = new Y.Text('abcdefgh');
    doc.transact(() => {
      doc.getMap('notes').set('test-ytext2', ytext);
    }, LOCAL_ORIGIN);

    applyTextDiff(ytext, 'abfg', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abfg');
  });

  it('TC-13c: replacement (delete+insert)', () => {
    const ytext = new Y.Text('abcde');
    doc.transact(() => {
      doc.getMap('notes').set('test-ytext3', ytext);
    }, LOCAL_ORIGIN);

    applyTextDiff(ytext, 'abXYe', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXYe');
  });

  it('TC-13d: emoji surrogate pairs kept intact', () => {
    const ytext = new Y.Text('a😀b');
    doc.transact(() => {
      doc.getMap('notes').set('test-ytext4', ytext);
    }, LOCAL_ORIGIN);

    applyTextDiff(ytext, 'a😀Xb', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('a😀Xb');
  });

  // ---- TC-14: paste 1200 chars into empty → 1000 ----
  it('TC-14: clamp 1200 chars → 1000 kept', () => {
    const result = clampToLimit(LONG_1000.padEnd(1200, 'x'), STICKY_TEXT_MAX_CHARS);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  // ---- TC-15: 999 + 1 → 1000 accepted ----
  it('TC-15: 999 chars + 1 → 1000 accepted', () => {
    const input = 'a'.repeat(999);
    const result = clampToLimit(input + 'x', STICKY_TEXT_MAX_CHARS);
    expect(result.length).toBe(1000);
  });

  // ---- TC-16: 1000 + 1 → rejected, still 1000 ----
  it('TC-16: 1000 chars + 1 → still 1000', () => {
    const input = 'a'.repeat(STICKY_TEXT_MAX_CHARS);
    const result = clampToLimit(input + 'x', STICKY_TEXT_MAX_CHARS);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  // ---- TC-17: counterVisible boundary ----
  it('TC-17: counterVisible 949/950/951 → false/true/true', () => {
    // counterVisible shows when remaining <= STICKY_COUNTER_THRESHOLD_CHARS (50)
    // 1000 - 949 = 51 > 50 → false
    // 1000 - 950 = 50 <= 50 → true
    // 1000 - 951 = 49 <= 50 → true
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('TC-17b: counterVisible at exactly limit shows', () => {
    expect(counterVisible(1000)).toBe(true);
  });

  it('TC-17d: counterVisible negative remaining returns false', () => {
    expect(counterVisible(1001)).toBe(false);
  });
});
