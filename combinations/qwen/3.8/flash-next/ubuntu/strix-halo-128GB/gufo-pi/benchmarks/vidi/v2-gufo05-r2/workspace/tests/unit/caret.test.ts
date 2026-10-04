import { describe, expect, it } from 'vitest';

import { mapCaretPosition } from '../../src/client/objects/caret';

/**
 * Unit: TC-01..TC-06 — where the caret goes when the text underneath it changes
 * (pure function: tests call the real code path the editor uses, with no DOM).
 *
 * TC-01 text before the caret · TC-02 text after the caret ·
 * TC-03 a deletion before the caret · TC-04 text replaced where the caret was ·
 * TC-05 an empty-to-text change · TC-06 positions outside the text.
 */

describe('caret mapping (TC-01..TC-06)', () => {
  it('TC-01: text inserted before the caret carries the caret along', () => {
    expect(mapCaretPosition('hello', 'say hello', 2)).toBe(6);
    expect(mapCaretPosition('', 'hello', 0)).toBe(0);
  });

  it('TC-02: text inserted after the caret leaves it where it was', () => {
    expect(mapCaretPosition('hello', 'hello world', 2)).toBe(2);
    expect(mapCaretPosition('hello', 'hello world', 5)).toBe(5);
  });

  it('TC-03: text deleted before the caret pulls it back, never before the start', () => {
    // 'hello ' went away: the character the caret sat on ('r') is now at 2.
    expect(mapCaretPosition('hello world', 'world', 8)).toBe(2);
    // A caret inside the text that was deleted lands at the start.
    expect(mapCaretPosition('hello world', 'world', 3)).toBe(0);
  });

  it('TC-04: text replaced where the caret sat puts the caret at the start of the change', () => {
    // 'hello' became 'goodbye', so the change starts at 4.
    expect(mapCaretPosition('say hello', 'say goodbye', 5)).toBe(4);
    expect(mapCaretPosition('say hello', 'say goodbye', 8)).toBe(4);
    // A caret before the change does not move.
    expect(mapCaretPosition('say hello', 'say goodbye', 2)).toBe(2);
  });

  it('TC-05: text appearing where there was none', () => {
    expect(mapCaretPosition('', 'hello', 0)).toBe(0);
    expect(mapCaretPosition('a', 'banana', 1)).toBe(6);
  });

  it('TC-06: positions outside the text are clamped into it', () => {
    // Text appended where the caret already was: the caret stays at that point.
    expect(mapCaretPosition('hello', 'hello there', 999)).toBe(5);
    // All the text changed: a caret past the end ends up past the new end.
    expect(mapCaretPosition('hello', 'goodbye', 999)).toBe(7);
    expect(mapCaretPosition('hello', 'hello', -5)).toBe(0);
  });

  it('a change that does not change anything leaves the caret alone', () => {
    expect(mapCaretPosition('same', 'same', 2)).toBe(2);
  });
});
