// undo.boundaries (unit): typing-burst grouping by the capture timeout, driven by a
// controlled clock. The controller's `Y.UndoManager` reads its "now" through
// `lib0/time`'s `getUnixTime`, so the tests mock that single function to place two
// keystrokes exactly `UNDO_CAPTURE_TIMEOUT_MS` or one millisecond apart - a
// boundary a real timer can never hit reliably.
// TC ids are the Acceptance Cases in
// spec/stories/008-undo-and-redo-my-own-changes-without-undoing-anyon/design.md.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// A controllable clock for yjs' capture-timeout maths. `vi.hoisted` gives the mock
// factory a reference it can close over; everything else in lib0/time stays real.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => clock.now };
});

import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

/** A board with one empty note, its text, and a fresh undo controller. */
function typingSetup(): { text: Y.Text; undo: UndoController } {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = createUndo(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  undo.boundary(); // the create is its own step; typing begins a new window
  const text = getStickyText(doc, id)!;
  clock.now = 1000; // a non-zero base so the first keystroke is "after" a change
  return { text, undo };
}

/** Type one character at time `at`, as the editor writes each keystroke (tracked). */
function keyAt(text: Y.Text, at: number, char: string): void {
  clock.now = at;
  text.doc!.transact(() => text.insert(text.length, char), LOCAL_ORIGIN);
}

describe('undo.boundaries (typing bursts)', () => {
  it('TC-12 merges keystrokes 100ms apart into one undo step', () => {
    const { text, undo } = typingSetup();

    const word = 'hello';
    for (let i = 0; i < word.length; i++) keyAt(text, 1000 + i * 100, word[i]!);
    undo.boundary(); // end the burst

    expect(text.toString()).toBe('hello');
    expect(undo.canUndo()).toBe(true);

    // one undo removes the whole burst
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // only the create step is left, so the burst was exactly one step
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 splits a pause of exactly the capture timeout into two steps', () => {
    const { text, undo } = typingSetup();

    keyAt(text, 1000, 'a');
    keyAt(text, 1000 + UNDO_CAPTURE_TIMEOUT_MS, 'b'); // exactly the timeout later
    undo.boundary();

    expect(text.toString()).toBe('ab');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('a'); // only the second burst was undone
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
  });

  it('TC-13 keeps a pause one millisecond short of the timeout as one step', () => {
    const { text, undo } = typingSetup();

    keyAt(text, 1000, 'a');
    keyAt(text, 1000 + UNDO_CAPTURE_TIMEOUT_MS - 1, 'b'); // one ms short
    undo.boundary();

    expect(text.toString()).toBe('ab');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe(''); // both characters were one step
  });
});
