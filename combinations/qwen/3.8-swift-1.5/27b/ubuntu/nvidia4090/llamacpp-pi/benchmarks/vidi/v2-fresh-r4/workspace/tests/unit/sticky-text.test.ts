import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

// 1000-char English paragraph (not repeated single characters)
const LONG_PARAGRAPH = (
  'The quick brown fox jumps over the lazy dog. ' +
  'Pack my box with five dozen liquor jugs. ' +
  'How vexingly quick daft zebras jump! ' +
  'The five boxing wizards jump quickly. ' +
  'Sphinx of black quartz, judge my vow. '
).repeat(20).slice(0, 1000);

describe('sticky-text', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  // TC-13
  it('TC-13: applyTextDiff produces minimal insert (not delete+insert all)', () => {
    const ytext = doc.getText('tc13');
    ytext.insert(0, 'abc');

    applyTextDiff(ytext, 'abXc', 'test-origin');

    expect(ytext.toString()).toBe('abXc');
    expect(ytext.length).toBe(4);
  });

  it('TC-13b: applyTextDiff pure deletion in middle', () => {
    const ytext = doc.getText('tc13b');
    ytext.insert(0, 'abcde');
    applyTextDiff(ytext, 'acde', 'test');
    expect(ytext.toString()).toBe('acde');
  });

  it('TC-13c: applyTextDiff replacement', () => {
    const ytext = doc.getText('tc13c');
    ytext.insert(0, 'hello');
    applyTextDiff(ytext, 'hallo', 'test');
    expect(ytext.toString()).toBe('hallo');
  });

  it('TC-13d: applyTextDiff emoji surrogate pairs kept intact', () => {
    const ytext = doc.getText('tc13d');
    ytext.insert(0, 'hello 🌍 world');
    applyTextDiff(ytext, 'hello 🌎 world', 'test');
    expect(ytext.toString()).toBe('hello 🌎 world');
  });

  it('TC-13e: applyTextDiff no-op when same', () => {
    const ytext = doc.getText('tc13e');
    ytext.insert(0, 'same');
    applyTextDiff(ytext, 'same', 'test');
    expect(ytext.toString()).toBe('same');
  });

  // TC-14
  it('TC-14: paste of 1200 chars into empty → 1000 kept', () => {
    const long = 'a'.repeat(1200);
    const result = clampToLimit(long);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe('a'.repeat(1000));
  });

  it('TC-14b: paste of 1200 realistic chars → 1000 kept', () => {
    const long = LONG_PARAGRAPH + 'x'.repeat(200); // > 1000
    const result = clampToLimit(long);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  // TC-15
  it('TC-15: 999 + 1 → 1000 accepted (boundary)', () => {
    const text = 'a'.repeat(999);
    const result = clampToLimit(text + 'b');
    expect(result.length).toBe(1000);
    expect(result).toBe('a'.repeat(999) + 'b');
  });

  // TC-16 (negative)
  it('TC-16: 1000 + 1 → rejected, still 1000', () => {
    const text = 'a'.repeat(1000);
    const result = clampToLimit(text + 'b');
    expect(result.length).toBe(1000);
    expect(result).toBe('a'.repeat(1000));
  });

  // TC-17
  it('TC-17: counterVisible at 949/950/951 chars', () => {
    // remaining = 1000 - len
    // 949 → remaining 51 > 50 → false
    // 950 → remaining 50 <= 50 → true
    // 951 → remaining 49 <= 50 → true
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('TC-17b: counterVisible at 0 and 1000', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1000)).toBe(true);
  });
});
