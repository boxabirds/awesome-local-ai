// Story 9: caret mapping through a Y.Text delta (text.concurrent). When a
// remote change arrives mid-edit the caret must follow it. These cases pin the
// convention: insert-at-caret pushes the caret right; a delete containing the
// caret collapses it to the deletion point; edits before the caret shift it and
// edits after leave it put.

import { describe, it, expect } from 'vitest';
import { mapCaretThroughDelta, type TextDeltaOp } from '../../src/client/objects/caret-delta';

describe('mapCaretThroughDelta', () => {
  it('keeps a caret at the end when text is appended at the end', () => {
    // "ab" -> "abc" (append at the end); caret was at the end (2).
    const delta: TextDeltaOp[] = [{ retain: 2 }, { insert: 'c' }];
    expect(mapCaretThroughDelta(delta, 2)).toBe(3);
  });

  it('pushes a caret right when an insert lands exactly at the caret', () => {
    // "abcd", caret after "ab" (2); remote inserts "X" at the caret -> "abXcd".
    const delta: TextDeltaOp[] = [{ retain: 2 }, { insert: 'X' }, { retain: 2 }];
    expect(mapCaretThroughDelta(delta, 2)).toBe(3);
  });

  it('shifts a caret right for an insert before it', () => {
    // "abcd", caret at 3; remote inserts "X" at the start -> "Xabcd".
    const delta: TextDeltaOp[] = [{ insert: 'X' }, { retain: 4 }];
    expect(mapCaretThroughDelta(delta, 3)).toBe(4);
  });

  it('leaves a caret put for an insert after it', () => {
    // "abcd", caret at 1; remote inserts "X" at the end -> "abcdX".
    const delta: TextDeltaOp[] = [{ retain: 4 }, { insert: 'X' }];
    expect(mapCaretThroughDelta(delta, 1)).toBe(1);
  });

  it('shifts a caret left for a delete before it', () => {
    // "abcd", caret at 3; remote deletes "a" -> "bcd".
    const delta: TextDeltaOp[] = [{ delete: 1 }, { retain: 3 }];
    expect(mapCaretThroughDelta(delta, 3)).toBe(2);
  });

  it('collapses a caret to the deletion point when the delete contains it', () => {
    // "abcd", caret at 2 (between b and c); remote deletes "bc" -> "ad".
    const delta: TextDeltaOp[] = [{ retain: 1 }, { delete: 2 }, { retain: 1 }];
    expect(mapCaretThroughDelta(delta, 2)).toBe(1);
  });

  it('handles combined retain+insert operations', () => {
    // "ab", caret at the end (2); combined {retain:2, insert:"xyz"} -> "abxyz".
    const delta: TextDeltaOp[] = [{ retain: 2, insert: 'xyz' }];
    expect(mapCaretThroughDelta(delta, 2)).toBe(5);
  });

  it('returns the new end when the caret is at the end and the text is replaced by growth', () => {
    // "a", caret at 1; grow to "abcde" by inserting "bcde" at the end.
    const delta: TextDeltaOp[] = [{ retain: 1 }, { insert: 'bcde' }];
    expect(mapCaretThroughDelta(delta, 1)).toBe(5);
  });
});
