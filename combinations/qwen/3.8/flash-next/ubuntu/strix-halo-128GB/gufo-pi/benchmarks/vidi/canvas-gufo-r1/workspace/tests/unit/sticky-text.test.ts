import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

function makeYText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = new Y.Text(initial);
  doc.getMap('test').set('text', ytext);
  return ytext;
}

describe('sticky-text', () => {
  // TC-13: applyTextDiff 'abc' → 'abXc' produces a single insert of 'X' at index 2
  it('TC-13 applyTextDiff inserts only the changed portion (common prefix/suffix)', () => {
    const ytext = makeYText('abc');
    const deltas: unknown[][] = [];
    ytext.observe((e) => { deltas.push(JSON.parse(JSON.stringify(e.delta))); });

    applyTextDiff(ytext, 'abXc', null);

    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    // Should be a single insert of 'X' at position 2, NOT delete-all + insert-all
    const delta = deltas[0];
    expect(delta).toHaveLength(2);
    expect(delta[0]).toEqual({ retain: 2 });
    expect(delta[1]).toEqual({ insert: 'X' });
  });

  it('TC-13b applyTextDiff handles deletion in middle', () => {
    const ytext = makeYText('abcdef');
    const deltas: unknown[][] = [];
    ytext.observe((e) => { deltas.push(JSON.parse(JSON.stringify(e.delta))); });

    applyTextDiff(ytext, 'abcf', null);

    expect(ytext.toString()).toBe('abcf');
    expect(deltas).toHaveLength(1);
    const delta = deltas[0];
    // prefix=3 ('abc'), suffix=1 ('f'), delete 'de' (2 chars) at pos 3
    expect(delta).toHaveLength(2);
    expect(delta[0]).toEqual({ retain: 3 });
    expect(delta[1]).toEqual({ delete: 2 });
  });

  it('TC-13c applyTextDiff handles replacement of a selection', () => {
    const ytext = makeYText('hello world');
    const deltas: unknown[][] = [];
    ytext.observe((e) => { deltas.push(JSON.parse(JSON.stringify(e.delta))); });

    applyTextDiff(ytext, 'hello there', null);

    expect(ytext.toString()).toBe('hello there');
    expect(deltas).toHaveLength(1);
    // Should retain 'hello ' then delete 'world' and insert 'there'
    const delta = deltas[0];
    // At minimum it should NOT be a full delete + full insert
    // Full delete would be: [{delete: 11}, {insert: 'hello there'}]
    // Minimal: retain 6, delete 5, insert 'there'
    expect(delta[0]).toEqual({ retain: 6 });
  });

  it('TC-13d applyTextDiff keeps emoji surrogate pairs intact', () => {
    const ytext = makeYText('Hi \u{1F600} there');
    applyTextDiff(ytext, 'Hi \u{1F600}! there', null);
    expect(ytext.toString()).toBe('Hi \u{1F600}! there');
    // Verify the emoji is intact (not split)
    expect(ytext.toString()).toContain('\u{1F600}');
  });

  // TC-14: paste of 1200 chars → 1000 kept
  it('TC-14 clampToLimit truncates 1200 chars to 1000', () => {
    // Use realistic English text, not repeated characters
    const base = 'The quick brown fox jumps over the lazy dog. ';
    const long = base.repeat(Math.ceil(1200 / base.length)).slice(0, 1200);
    expect(long.length).toBe(1200);
    const clamped = clampToLimit(long);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(long.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  // TC-15: 999 + 1 → 1000 accepted
  it('TC-15 clampToLimit allows exactly 1000 chars', () => {
    const base = 'The quick brown fox jumps over the lazy dog. ';
    const text = base.repeat(Math.ceil(999 / base.length)).slice(0, 999);
    expect(text.length).toBe(999);
    const clamped = clampToLimit(text + 'x');
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  // TC-16: 1000 + 1 → rejected, still 1000
  it('TC-16 clampToLimit rejects beyond 1000 chars', () => {
    const base = 'The quick brown fox jumps over the lazy dog. ';
    const text = base.repeat(Math.ceil(1000 / base.length)).slice(0, 1000);
    expect(text.length).toBe(STICKY_TEXT_MAX_CHARS);
    const clamped = clampToLimit(text + 'y');
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(text);
  });

  // TC-17: counterVisible at 949/950/951 chars
  it('TC-17 counterVisible boundary: 949 false, 950 true, 951 true', () => {
    // remaining = max - len = 1000 - len
    // threshold = 50, so counter visible when remaining <= 50
    // 1000 - 949 = 51 > 50 → false
    // 1000 - 950 = 50 <= 50 → true
    // 1000 - 951 = 49 <= 50 → true
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('TC-17b counterVisible for short text is false', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(100)).toBe(false);
  });
});
