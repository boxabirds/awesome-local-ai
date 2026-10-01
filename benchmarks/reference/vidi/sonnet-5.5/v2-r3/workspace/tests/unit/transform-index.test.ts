import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { transformIndex } from '../../src/client/objects/StickyText';

/** Applies `edit` to a text holding `initial` and returns where a caret at `caret` ends up. */
function caretAfter(initial: string, caret: number, edit: (t: Y.Text) => void): number {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, initial);
  let result = -1;
  t.observe((e) => {
    result = transformIndex(e.changes.delta, caret);
  });
  edit(t);
  return result;
}

describe('transformIndex (remote edits move the local caret)', () => {
  it('an insert before the caret shifts it right', () => {
    expect(caretAfter('green', 5, (t) => t.insert(0, 'red '))).toBe(9);
  });
  it('an insert after the caret leaves it alone', () => {
    expect(caretAfter('green', 2, (t) => t.insert(5, ' blue'))).toBe(2);
  });
  it('an insert exactly at the caret does not push it', () => {
    expect(caretAfter('green', 2, (t) => t.insert(2, 'XX'))).toBe(2);
  });
  it('a delete before the caret shifts it left', () => {
    expect(caretAfter('abcdef', 5, (t) => t.delete(0, 2))).toBe(3);
  });
  it('a delete spanning the caret collapses it to the start of the range', () => {
    expect(caretAfter('abcdef', 4, (t) => t.delete(2, 4))).toBe(2);
  });
});
