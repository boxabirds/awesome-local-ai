/**
 * TC-23's helper, in isolation: where a caret belongs when somebody else's
 * characters arrive in text that is being edited. The e2e test (TC-23) can only
 * say "the merged text is right"; these say why the caret stayed in the word it
 * was in. See src/client/objects/remote-text.ts.
 */

import { describe, expect, it } from 'vitest';

import { mapCaret, mapIndex, type TextDeltaOp } from '../../src/client/objects/remote-text';

const keep = (n: number): TextDeltaOp => ({ retain: n });
const insert = (text: string): TextDeltaOp => ({ insert: text });
const remove = (n: number): TextDeltaOp => ({ delete: n });

describe('mapIndex (a caret through somebody else’s change)', () => {
  it('text inserted before the caret pushes it right', () => {
    // "green", "blue " inserted at 0 -> caret at 5 sits after the new word.
    expect(mapIndex(5, [insert('blue '), keep(5)])).toBe(10);
  });

  it('text inserted at the caret pushes it right too', () => {
    // The caret at 0 stays in front of its own next character, not inside the
    // word somebody else just typed.
    expect(mapIndex(0, [insert('red '), keep(5)])).toBe(4);
  });

  it('text inserted after the caret leaves it alone', () => {
    expect(mapIndex(2, [keep(5), insert('!')])).toBe(2);
  });

  it('text deleted before the caret pulls it left', () => {
    // "green blue", "green " removed -> the caret at 8 is now at 2.
    expect(mapIndex(8, [remove(6), keep(4)])).toBe(2);
  });

  it('a caret inside deleted text falls back to where that text began', () => {
    expect(mapIndex(3, [keep(2), remove(4), keep(2)])).toBe(2);
  });

  it('a caret after deleted text moves left by what went', () => {
    // "ab" + "cdef" + "gh": the caret at 8 (end) is at 4 once "cdef" is gone.
    expect(mapIndex(8, [keep(2), remove(4), keep(2)])).toBe(4);
  });

  it('several changes in one update add up', () => {
    // "green": put "red " in front, then drop the "ee" out of the middle.
    // "green" -> "red grn", and the caret that was at the end of "green" is at
    // the end of "red grn" as well.
    const delta: TextDeltaOp[] = [insert('red '), keep(2), remove(2), keep(1)];
    expect(mapIndex(5, delta)).toBe(7);
  });

  it('an empty update changes nothing', () => {
    expect(mapIndex(3, [])).toBe(3);
    expect(mapIndex(3, [keep(9)])).toBe(3);
  });

  it('text running past the last operation still counts', () => {
    // A delta that only keeps 5 characters, with the caret at the end of a
    // 7-character value (a stale editor): the tail is not lost.
    expect(mapIndex(7, [keep(5)])).toBe(7);
  });
});

describe('mapCaret (a selection through somebody else’s change)', () => {
  it('moves both ends together', () => {
    expect(mapCaret({ start: 2, end: 5 }, [insert('red '), keep(9)])).toEqual({ start: 6, end: 9 });
  });

  it('narrows instead of pointing past the end when their text is removed', () => {
    // The selection covers what somebody else deleted: what is left of it is
    // nothing, and it must not reach behind the start.
    expect(mapCaret({ start: 1, end: 6 }, [keep(1), remove(4), keep(1)]).start).toBe(1);
    expect(mapCaret({ start: 1, end: 6 }, [keep(1), remove(4), keep(1)]).end).toBeGreaterThanOrEqual(1);
  });

  it('never ends up backwards', () => {
    const caret = mapCaret({ start: 4, end: 5 }, [keep(2), remove(3)]);
    expect(caret.end).toBeGreaterThanOrEqual(caret.start);
  });
});
