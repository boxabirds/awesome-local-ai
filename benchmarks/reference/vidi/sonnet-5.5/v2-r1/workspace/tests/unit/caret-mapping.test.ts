import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mapCaretThroughDelta } from '../../src/client/objects/StickyText';

/** Applies `change` to a doc holding `initial` and returns the delta Yjs reports for it. */
function deltaOf(initial: string, change: (t: Y.Text) => void) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, initial);
  let delta: Y.YTextEvent['delta'] = [];
  t.observe((e) => {
    delta = e.delta;
  });
  change(t);
  return delta;
}

describe('mapCaretThroughDelta', () => {
  it('shifts a caret right when text is inserted before it', () => {
    expect(mapCaretThroughDelta(5, deltaOf('green', (t) => t.insert(0, 'red ')))).toBe(9);
  });

  it('keeps a caret in place when text is inserted after it', () => {
    expect(mapCaretThroughDelta(0, deltaOf('green', (t) => t.insert(5, ' blue')))).toBe(0);
  });

  it('keeps a caret in place when text is inserted exactly at it', () => {
    expect(mapCaretThroughDelta(3, deltaOf('green', (t) => t.insert(3, 'XX')))).toBe(3);
  });

  it('pulls a caret left by deletions before it, clamped to the deletion start', () => {
    expect(mapCaretThroughDelta(5, deltaOf('green', (t) => t.delete(1, 2)))).toBe(3);
    expect(mapCaretThroughDelta(2, deltaOf('green', (t) => t.delete(1, 3)))).toBe(1);
  });

  it('never goes negative', () => {
    expect(mapCaretThroughDelta(0, deltaOf('green', (t) => t.delete(0, 5)))).toBe(0);
  });
});
