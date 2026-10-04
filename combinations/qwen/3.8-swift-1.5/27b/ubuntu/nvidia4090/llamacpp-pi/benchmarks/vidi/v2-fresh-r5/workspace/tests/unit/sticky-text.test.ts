import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

// Build a realistic 1000-char English paragraph (not repeated single chars)
function makeText(len: number): string {
  const words = ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog', 'near',
    'the', 'old', 'stone', 'bridge', 'where', 'rivers', 'meet', 'and', 'willows', 'bend',
    'over', 'quiet', 'waters', 'reflecting', 'clouds', 'drifting', 'slowly', 'across',
    'a', 'pale', 'afternoon', 'sky', 'while', 'birds', 'circle', 'above', 'the', 'fields'];
  let result = '';
  let i = 0;
  while (result.length < len) {
    if (result.length > 0) result += ' ';
    result += words[i % words.length];
    i++;
  }
  return result.slice(0, len);
}

describe('sticky-text', () => {
  // TC-13: applyTextDiff 'abc' → 'abXc' produces single insert at index 2
  it('TC-13: applyTextDiff produces minimal insert for single char change', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'abc');

    const deltas: Array<Record<string, unknown>> = [];
    const handler = (event: { delta: Array<Record<string, unknown>> }) => {
      for (const d of event.delta) deltas.push(d);
    };
    ytext.observe(handler);

    applyTextDiff(ytext, 'abXc', 'test-origin');

    // Should be a single insert of 'X' at position 2, not delete-all + insert-all
    expect(ytext.toString()).toBe('abXc');
    // The delta should contain an insert (not a full replace)
    const hasInsert = deltas.some(d => 'insert' in d);
    const hasDelete = deltas.some(d => 'delete' in d);
    // For 'abc' → 'abXc', we expect an insert of 1 char and no delete
    expect(hasInsert).toBe(true);
    expect(hasDelete).toBe(false);
  });

  it('TC-13b: applyTextDiff produces minimal delete for deletion in middle', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'abcde');

    applyTextDiff(ytext, 'abde', 'test-origin');
    expect(ytext.toString()).toBe('abde');
  });

  it('TC-13c: applyTextDiff handles emoji surrogate pairs', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'a😀b');

    applyTextDiff(ytext, 'a😀c', 'test-origin');
    expect(ytext.toString()).toBe('a😀c');
  });

  // TC-14: paste of 1,200 chars into empty → 1,000 kept
  it('TC-14: clampToLimit keeps exactly 1000 chars from 1200', () => {
    const text = makeText(1200);
    const result = clampToLimit(text);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(text.slice(0, 1000));
  });

  // TC-15: 999 + 1 → 1,000 accepted
  it('TC-15: clampToLimit accepts exactly 1000 chars', () => {
    const text = makeText(1000);
    const result = clampToLimit(text);
    expect(result.length).toBe(1000);
    expect(result).toBe(text);
  });

  // TC-16: 1,000 + 1 → rejected, still 1,000
  it('TC-16: clampToLimit rejects 1001 chars, keeps 1000', () => {
    const text = makeText(1001);
    const result = clampToLimit(text);
    expect(result.length).toBe(1000);
    expect(result).toBe(text.slice(0, 1000));
  });

  // TC-17: counterVisible at 949/950/951
  it('TC-17: counterVisible at boundary values', () => {
    // remaining = 1000 - 949 = 51 > 50 → false
    expect(counterVisible(949)).toBe(false);
    // remaining = 1000 - 950 = 50 <= 50 → true
    expect(counterVisible(950)).toBe(true);
    // remaining = 1000 - 951 = 49 <= 50 → true
    expect(counterVisible(951)).toBe(true);
  });

  // Additional: clampToLimit with empty string
  it('clampToLimit with empty string returns empty', () => {
    expect(clampToLimit('')).toBe('');
  });

  // Additional: clampToLimit with short string
  it('clampToLimit with short string returns unchanged', () => {
    const text = 'Hello world';
    expect(clampToLimit(text)).toBe(text);
  });

  // Additional: counterVisible at 0
  it('counterVisible at 0 chars is false', () => {
    expect(counterVisible(0)).toBe(false);
  });

  // Additional: applyTextDiff no-op when strings are equal
  it('applyTextDiff is a no-op when strings are equal', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'hello');
    applyTextDiff(ytext, 'hello', 'test-origin');
    expect(ytext.toString()).toBe('hello');
  });
});
