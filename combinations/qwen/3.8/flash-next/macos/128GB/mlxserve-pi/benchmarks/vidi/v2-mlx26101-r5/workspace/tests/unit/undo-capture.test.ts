/**
 * What one action is, as the history sees it (story 8, `undo.boundaries` — the capture window).
 *
 * A drag writes a position every animation frame and a person typing writes a character at a time.
 * Yjs decides on its own when a run of writes stops being one thing and starts being two, and it
 * decides by a clock: writes closer together than the capture window are one step, a gap of the
 * window or longer is the start of the next one. The rule is inclusive at the boundary — a pause of
 * exactly half a second is two steps, which is the line the PRD draws when it says a burst of typing
 * runs "without a pause of half a second or more".
 *
 * These tests wait in real time, and say so, because the thing under test is a timeout. Two things
 * make that safe rather than flaky, and both are load-bearing:
 *
 * — the waits are always *at least* the interval being asserted, since a timer cannot fire early; and
 * — where the assertion is "under the window", the wait is comfortably under rather than one
 *   millisecond under, because a wait of 499 ms on a busy machine is a bet about the operating
 *   system, not a statement about the rule. The same rule is then checked at a window short enough
 *   that the millisecond next to it can be named out loud.
 *
 * `Date.now` cannot be replaced to make these fast: `lib0/time` takes the function by reference when
 * it is loaded, so a clock swapped in afterwards is a clock Yjs never looks at. Fake timers would
 * leave the capture window running on the real one, which is exactly the kind of test that passes.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createSticky, getStickyText, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyTextDiff } from '../../src/client/objects/StickyText';
import { connectPeer, loadFrom } from './helpers/peer';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A board holding one note that arrived from elsewhere, and a history that is empty to start with. */
function boardWithANote(undoOptions?: { captureTimeoutMs?: number; maxSteps?: number }): {
  doc: Y.Doc;
  undo: UndoController;
  id: string;
} {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = connectPeer(doc);
  const id = (() => {
    const created = createSticky(peer.doc, { x: 0, y: 0 });
    if (typeof created !== 'string') throw new Error('the board refused to make a note');
    return created;
  })();
  loadFrom(peer.doc, doc);
  const undo = createUndo(doc, undoOptions);
  peer.close();
  return { doc, undo, id };
}

/** Types `text` into the note, one character at a time, the way the editor does. */
function typeChar(doc: Y.Doc, id: string, char: string): void {
  const ytext = getStickyText(doc, id);
  if (ytext === undefined) throw new Error('the note has no text');
  applyTextDiff(ytext, ytext.toString() + char, LOCAL_ORIGIN);
}

const textOf = (doc: Y.Doc, id: string): string => getStickyText(doc, id)?.toString() ?? '';

describe('a burst of typing', () => {
  it('TC-12 is one step, however many transactions it was written in', async () => {
    const { doc, undo, id } = boardWithANote();
    expect(undo.canUndo()).toBe(false);

    // The boundaries are what the board puts around an edit: the editor closes the step that was open
    // when the note was opened, and opens the next one when it goes away. Everything between them is
    // this edit, and the history's own half second is what separates one keystroke run from another.
    undo.boundary();
    for (const char of 'ship it') {
      typeChar(doc, id, char);
      await sleep(100); // well inside the window, and the wait is the typing, not the test being slow
    }
    undo.boundary();

    expect(textOf(doc, id)).toBe('ship it');
    // One press takes back the whole word, not the last letter of it.
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('');
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });

  it('TC-13 splits a burst at the pause that is as long as the window, and not before', async () => {
    const { doc, undo, id } = boardWithANote();

    undo.boundary();
    typeChar(doc, id, 'a');
    await sleep(UNDO_CAPTURE_TIMEOUT_MS);
    typeChar(doc, id, 'b');
    undo.boundary();

    // A pause of exactly half a second ends a step: the person stopped, thought, and started again.
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('a');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 keeps a pause shorter than the window inside the same step', async () => {
    // The same rule, at a window short enough to name: a pause of one third of it is the same thing
    // the person was doing, and only a pause of all of it is not. Shrinking the window is what lets
    // the millisecond next to the boundary be a decision rather than a race — a timer can arrive late
    // but never early, so 'at least the window' always splits and 'a third of it' never does.
    const window = 60;
    const { doc, undo, id } = boardWithANote({ captureTimeoutMs: window });

    undo.boundary();
    typeChar(doc, id, 'a');
    await sleep(Math.round(window / 3));
    typeChar(doc, id, 'b');
    await sleep(Math.round(window / 3));
    typeChar(doc, id, 'c');
    undo.boundary();

    expect(textOf(doc, id)).toBe('abc');
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('');
    // One step, for three writes a twentieth of a second apart: the pause was a hesitation, and the
    // history did not turn it into two things the person did.
    expect(undo.canUndo()).toBe(false);

    // And exactly at the window, the same three writes are three things.
    const at = boardWithANote({ captureTimeoutMs: window });
    at.undo.boundary();
    typeChar(at.doc, at.id, 'a');
    await sleep(window);
    typeChar(at.doc, at.id, 'b');
    at.undo.boundary();
    expect(at.undo.undo()).toBe(true);
    expect(textOf(at.doc, at.id)).toBe('a');
    expect(at.undo.canUndo()).toBe(true);
  });

  it('TC-12 counts the boundaries, not the number of transactions: a drag is one step too', async () => {
    // The point of the drag half of the story, in the cheapest shape that shows it: many writes inside
    // one pair of boundaries, one step. A real drag goes through the pointer and the gesture hook, and
    // `tests/component/UndoBoundaries.test.tsx` is where that is checked; what this pins down is that
    // the history does what the board asks it to and nothing else.
    const { doc, undo, id } = boardWithANote();
    const map = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const started = map.get('x');

    undo.boundary();
    for (let frame = 0; frame < 30; frame += 1) {
      // A frame of a drag: one transaction, written with the board's own origin, four milliseconds
      // after the last one. Twenty-nine gaps of four milliseconds is no pause at all.
      doc.transact(() => {
        map.set('x', 100 + frame);
      }, LOCAL_ORIGIN);
      await sleep(4);
    }
    undo.boundary();

    expect(map.get('x')).toBe(129);
    expect(undo.undo()).toBe(true);
    // All thirty frames at once, back to where the drag started.
    expect(map.get('x')).toBe(started);
    expect(undo.canUndo()).toBe(false);
  });
});
