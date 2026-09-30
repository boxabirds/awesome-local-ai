// Typing bursts group by the named capture timeout (`undo.typing`, TC-12, TC-13).
//
// A fake clock drives the controller's capture window so the boundary is exact:
// keystrokes closer than `UNDO_CAPTURE_TIMEOUT_MS` are one undo step, a pause of
// that long or longer starts a new one. The inserts open real `LOCAL_ORIGIN`
// transactions on a sticky note's shared text, which is inside the undo scope.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

/** A note plus a controller watching it, with a fresh timer world. */
function probe(): { doc: Y.Doc; undo: UndoController; text: Y.Text } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  const undo = createUndo(doc);
  const text = getStickyText(doc, id)!;
  return { doc, undo, text };
}

/** A keystroke: one `LOCAL_ORIGIN` transaction on the shared text. */
const type = (doc: Y.Doc, text: Y.Text, characters: string): void => {
  doc.transact(() => {
    text.insert(text.length, characters);
  }, LOCAL_ORIGIN);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('undo.typing (capture-timeout grouping)', () => {
  // TC-12: a burst typed faster than the pause is a single step.
  it('TC-12 folds keystrokes 100 ms apart into one undo step', () => {
    const { doc, undo, text } = probe();
    undo.boundary();
    type(doc, text, 'a');
    vi.advanceTimersByTime(100);
    type(doc, text, 'b');
    vi.advanceTimersByTime(100);
    type(doc, text, 'c');
    undo.boundary();

    expect(text.toString()).toBe('abc');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    // The whole burst went back in one undo, and there is nothing older to undo.
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13: the pause boundary is exact — exactly the setting splits, one ms less does not.
  it('TC-13 starts a new step at exactly the pause and merges one millisecond under it', () => {
    // A pause of exactly UNDO_CAPTURE_TIMEOUT_MS: two steps.
    const split = probe();
    split.undo.boundary();
    type(split.doc, split.text, 'a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    type(split.doc, split.text, 'b');
    split.undo.boundary();
    expect(split.undo.undo()).toBe(true);
    expect(split.text.toString()).toBe('a'); // only the second burst undone
    expect(split.undo.canUndo()).toBe(true);

    // One millisecond under the pause: still one step.
    const merged = probe();
    merged.undo.boundary();
    type(merged.doc, merged.text, 'a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type(merged.doc, merged.text, 'b');
    merged.undo.boundary();
    expect(merged.undo.undo()).toBe(true);
    expect(merged.text.toString()).toBe(''); // both went together
    expect(merged.undo.canUndo()).toBe(false);
  });

  // Closing an empty window is harmless.
  it('ignores a boundary called with nothing captured', () => {
    const { undo } = probe();
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
