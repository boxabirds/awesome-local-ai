/**
 * One person's undo history, on its own (`undo.own`, `undo.steps`, `undo.limit`,
 * `undo.safe`, `undo.session_only`, `undo.typing`).
 *
 * Story 8 is a story about *who* changed something, and that is exactly the kind of thing
 * a test can get wrong by being easy: a board with one participant on it passes almost
 * anything. So these tests put a second real document on the other side of a relay
 * (`tests/unit/peer.ts`), and a third origin for a board read back out of storage, and ask
 * the controller to tell them apart by itself. Nothing here tells the controller what to
 * ignore; it only knows which origin this tab writes with.
 *
 * The clock is injected. That buys two things: the capture window is tested at 499 and at
 * 500 milliseconds rather than by sleeping and hoping (TC-13), and a gesture of thirty
 * frames costs nothing.
 *
 * TC-01  my undo, a peer's work untouched          TC-07  a step that cannot be reversed
 * TC-02  a peer's change is not recorded           TC-08  a peer cannot split my step
 * TC-03  a board loaded from storage               TC-09  the history limit, at the limit
 * TC-04  a delete of eight, restored               TC-10  nothing dropped below the limit
 * TC-05  redo                                      TC-11  a new controller starts empty
 * TC-06  a new change clears redo                 TC-12  a typing burst is one step
 *                                                    TC-13  the pause, to the millisecond
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObjects,
  getStickyText,
  LOCAL_ORIGIN,
  moveObjects,
  objectSnapshots,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { applyTextDiff } from '../../src/client/objects/StickyText';
import { connectPeer, loadInto, savedBoard, type Peer } from './peer';

/**
 * A board, its history, and a clock the test turns by hand.
 *
 * The clock starts an hour in, so no test can be fooled by the controller's meaning for
 * `0`, which is "no capture window is open at all".
 */
function fixture(options: { captureTimeoutMs?: number; maxSteps?: number } = {}) {
  const doc = new Y.Doc();
  let now = 3_600_000;
  const controller = createUndo(doc, {
    captureTimeoutMs: options.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS,
    maxSteps: options.maxSteps,
    now: () => now,
  });
  const peers: Peer[] = [];
  return {
    doc,
    controller,
    /** Move the clock on; the capture window is measured on this. */
    advance(ms: number): void {
      now += ms;
    },
    /** Another person, joined to this document. */
    peer(): Peer {
      const peer = connectPeer(doc);
      peers.push(peer);
      return peer;
    },
    /** How many steps undo can still take, counted by taking them. */
    drain(): number {
      let applied = 0;
      while (controller.undo()) applied += 1;
      return applied;
    },
    cleanup() {
      for (const peer of peers) peer.destroy();
      controller.destroy();
      doc.destroy();
    },
  };
}

type Board = ReturnType<typeof fixture>;

/** A note, placed, coloured and filled in: one step, whatever it takes to make it. */
function placeNote(
  board: Board,
  options: { x: number; y: number; text?: string; color?: 'yellow' | 'green' | 'pink' | 'blue' },
): string {
  const { doc, controller } = board;
  controller.boundary();
  const id = createSticky(doc, { x: options.x, y: options.y });
  const ytext = getStickyText(doc, id);
  if (ytext && options.text) applyTextDiff(ytext, options.text, LOCAL_ORIGIN);
  if (options.color) setStickyColor(doc, id, options.color);
  controller.boundary();
  return id;
}

/**
 * A note that came from storage rather than from me, so it is on the board without being
 * a step in my history. `savedBoard` writes the top-left corner, not a centre.
 */
function loadedNote(board: Board, id: string, x: number, y: number): string {
  loadInto(board.doc, savedBoard([{ id, x, y }]));
  return id;
}

/** Where the object with this id is, or undefined when it is no longer on the board. */
function placeOf(board: Board, id: string): { x: number; y: number } | undefined {
  const found = objectSnapshots(board.doc).find((object) => object.id === id);
  return found && { x: found.x, y: found.y };
}

/** The same note as a person reads it: text and colour included. */
function stickyOf(board: Board, id: string) {
  const found = snapshot(board.doc).find((object) => object.id === id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
}

describe('undo.own: an undo that reaches my changes only', () => {
  it('TC-01 undoes my move and leaves what a peer made and changed alone', () => {
    const board = fixture();
    const mine = placeNote(board, { x: 300, y: 300, text: 'move me' });
    const painted = placeNote(board, { x: 700, y: 300, text: 'peer paints me' });
    const peer = board.peer();

    // The peer recolours one of my notes and adds a note of their own.
    peer.transact(() => setStickyColor(peer.doc, painted, 'blue'));
    peer.transact(() => createSticky(peer.doc, { x: 1000, y: 600 }));

    // Then I move my note.
    moveObjects(board.doc, new Map([[mine, { x: 480, y: 520 }]]));
    expect(placeOf(board, mine)).toEqual({ x: 480, y: 520 });

    expect(board.controller.undo()).toBe(true);

    // My move is back. Their note is still there, and their colour is still on mine:
    // an undo reverses what I did, never what happened afterwards.
    expect(placeOf(board, mine)).toEqual({ x: 200, y: 200 });
    expect(stickyOf(board, painted).color).toBe('blue');
    expect(objectSnapshots(board.doc)).toHaveLength(3);
    board.cleanup();
  });

  it('TC-02 records nothing of a change made by somebody else', () => {
    const board = fixture();
    const peer = board.peer();
    let theirs = '';
    peer.transact(() => {
      theirs = createSticky(peer.doc, { x: 400, y: 400 });
    });
    expect(placeOf(board, theirs)).toEqual({ x: 300, y: 300 });

    // A note I never touched, moved entirely by the peer.
    peer.transact(() => moveObjects(peer.doc, new Map([[theirs, { x: 900, y: 900 }]])));

    // Nothing of mine to undo; and pressing undo does nothing rather than something
    // surprising.
    expect(board.controller.canUndo()).toBe(false);
    expect(board.controller.undo()).toBe(false);
    expect(board.controller.canRedo()).toBe(false);
    expect(board.controller.redo()).toBe(false);
    expect(placeOf(board, theirs)).toEqual({ x: 900, y: 900 });
    board.cleanup();
  });

  it('TC-03 offers nothing to undo on a board read back out of storage', () => {
    const board = fixture();
    loadInto(
      board.doc,
      savedBoard([
        { id: 'saved-1', x: 100, y: 100 },
        { id: 'saved-2', x: 400, y: 100 },
        { id: 'saved-3', x: 700, y: 100 },
      ]),
    );

    // Notes I "made" in an earlier session, arriving with the load origin rather than
    // with mine: the history is this tab's, and this tab has done nothing.
    expect(objectSnapshots(board.doc)).toHaveLength(3);
    expect(board.controller.canUndo()).toBe(false);
    expect(board.controller.canRedo()).toBe(false);
    expect(board.controller.undo()).toBe(false);
    expect(board.controller.redo()).toBe(false);
    expect(board.drain()).toBe(0);
    expect(objectSnapshots(board.doc)).toHaveLength(3);
    board.cleanup();
  });
});

describe('undo.steps: one action, one step', () => {
  it('TC-04 brings back all eight deleted notes, exactly as they were', () => {
    const board = fixture();
    const colors = ['yellow', 'green', 'pink', 'blue'] as const;
    const ids = Array.from({ length: 8 }, (_, index) =>
      placeNote(board, {
        x: 200 + index * 250,
        y: 400 + (index % 2) * 260,
        text: `note ${index + 1}`,
        color: colors[index % colors.length],
      }),
    );
    const before = snapshot(board.doc).map((object) => ({ ...object }));
    expect(before).toHaveLength(8);

    // Eight notes selected and one key: one thing happened, so one step back.
    deleteObjects(board.doc, ids);
    expect(objectSnapshots(board.doc)).toHaveLength(0);

    expect(board.controller.undo()).toBe(true);

    // The same eight, with their text, colour, size, place and stacking: the deleted
    // entries were restored whole, not rebuilt.
    expect(snapshot(board.doc)).toEqual(before);
    board.cleanup();
  });

  it('TC-08 a peer change in the middle of my drag neither splits it nor joins it', () => {
    const board = fixture();
    const peer = board.peer();
    const id = placeNote(board, { x: 300, y: 300 });
    const start = placeOf(board, id)!;

    // A drag: one write per animation frame, with a peer's note arriving between two.
    board.controller.boundary();
    for (let frame = 1; frame <= 6; frame += 1) {
      moveObjects(board.doc, new Map([[id, { x: start.x + frame * 16, y: start.y }]]));
      board.advance(16);
      if (frame === 3) peer.transact(() => createSticky(peer.doc, { x: 1500, y: 900 }));
    }
    expect(placeOf(board, id)).toEqual({ x: start.x + 96, y: start.y });

    // One press, and the whole gesture is undone at once.
    expect(board.controller.undo()).toBe(true);
    expect(placeOf(board, id)).toEqual(start);
    expect(objectSnapshots(board.doc).some((object) => object.x === 1400)).toBe(true);

    // And the gesture was one step, not six: under it lies only the note itself.
    expect(board.controller.canUndo()).toBe(true);
    board.controller.undo();
    expect(board.controller.canUndo()).toBe(false);
    board.cleanup();
  });

  it('TC-05 redoes what I undid, and only that', () => {
    const board = fixture();
    const peer = board.peer();
    const id = placeNote(board, { x: 300, y: 300, text: 'keep me' });
    peer.transact(() => setStickyColor(peer.doc, id, 'pink'));

    moveObjects(board.doc, new Map([[id, { x: 800, y: 800 }]]));
    expect(board.controller.undo()).toBe(true);
    expect(placeOf(board, id)).toEqual({ x: 200, y: 200 });
    expect(board.controller.canRedo()).toBe(true);

    expect(board.controller.redo()).toBe(true);
    expect(placeOf(board, id)).toEqual({ x: 800, y: 800 });
    // The peer's colour is no part of my history, in either direction.
    expect(stickyOf(board, id).color).toBe('pink');
    board.cleanup();
  });

  it('TC-06 a new change throws away what I had undone', () => {
    const board = fixture();
    const id = placeNote(board, { x: 300, y: 300 });
    moveObjects(board.doc, new Map([[id, { x: 500, y: 500 }]]));
    expect(board.controller.undo()).toBe(true);
    expect(board.controller.canRedo()).toBe(true);

    // Doing something new after an undo cannot keep a redo of a step that no longer
    // follows anything, so the branch is dropped, as it is in every editor.
    board.advance(2_000);
    setStickyColor(board.doc, id, 'blue');
    expect(board.controller.canRedo()).toBe(false);
    expect(board.controller.redo()).toBe(false);
    expect(stickyOf(board, id).color).toBe('blue');
    expect(placeOf(board, id)).toEqual({ x: 200, y: 200 });
    board.cleanup();
  });
});

describe('undo.typing: a burst is one step, until the person stops', () => {
  /** Type into a note the way the editor does: one diff per keystroke. */
  function type(board: Board, id: string, text: string, gapMs = 60): void {
    const ytext = getStickyText(board.doc, id);
    if (!ytext) throw new Error(`note ${id} has no text`);
    board.controller.boundary();
    let typed = '';
    for (const character of text) {
      applyTextDiff(ytext, `${typed}${character}`, LOCAL_ORIGIN);
      typed += character;
      board.advance(gapMs);
    }
  }

  const textOf = (board: Board, id: string): string => stickyOf(board, id).text;

  it('TC-12 keeps a burst in one step and starts a new one after a pause', () => {
    const board = fixture();
    const id = placeNote(board, { x: 300, y: 300 });

    type(board, id, 'hello');
    expect(textOf(board, id)).toBe('hello');
    expect(board.controller.undo()).toBe(true);
    // One step, so one press: the whole word goes, not the last letter.
    expect(textOf(board, id)).toBe('');

    type(board, id, 'bye');
    // The person stops to think, for longer than the capture window.
    board.advance(UNDO_CAPTURE_TIMEOUT_MS + 200);
    const ytext = getStickyText(board.doc, id)!;
    applyTextDiff(ytext, 'bye!', LOCAL_ORIGIN);
    expect(textOf(board, id)).toBe('bye!');

    expect(board.controller.undo()).toBe(true);
    expect(textOf(board, id)).toBe('bye');
    expect(board.controller.undo()).toBe(true);
    expect(textOf(board, id)).toBe('');
    board.cleanup();
  });

  it('TC-13 splits the burst at exactly the capture timeout, and not before', () => {
    const board = fixture();
    const id = placeNote(board, { x: 300, y: 300 });
    const ytext = getStickyText(board.doc, id)!;

    board.controller.boundary();
    applyTextDiff(ytext, 'a', LOCAL_ORIGIN);
    board.advance(60);
    applyTextDiff(ytext, 'ab', LOCAL_ORIGIN);

    // 499 ms after the last keystroke: still inside the window, so still the same step.
    board.advance(UNDO_CAPTURE_TIMEOUT_MS - 1);
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);
    expect(board.controller.undo()).toBe(true);
    expect(textOf(board, id)).toBe('');

    // And now exactly 500 ms: the next keystroke is a step of its own.
    applyTextDiff(ytext, 'x', LOCAL_ORIGIN);
    board.advance(UNDO_CAPTURE_TIMEOUT_MS);
    applyTextDiff(ytext, 'xy', LOCAL_ORIGIN);
    expect(board.controller.undo()).toBe(true);
    expect(textOf(board, id)).toBe('x');
    expect(board.controller.undo()).toBe(true);
    expect(textOf(board, id)).toBe('');
    board.cleanup();
  });
});

describe('undo.limit: the history is kept in memory, and has a bottom', () => {
  /**
   * A note from storage, then `count` moves of it, each its own step, each one pixel
   * further right than the last. The note itself is not a step: it was already there.
   */
  function moves(board: Board, count: number): string {
    const id = loadedNote(board, 'probe', 300, 300);
    for (let index = 0; index < count; index += 1) {
      board.controller.boundary();
      moveObjects(board.doc, new Map([[id, { x: 500 + index, y: 300 }]]));
      board.controller.boundary();
    }
    return id;
  }

  it('TC-09 drops the oldest step when a full history gains one', () => {
    const board = fixture();
    const id = moves(board, UNDO_MAX_STEPS + 1);
    expect(placeOf(board, id)).toEqual({ x: 500 + UNDO_MAX_STEPS, y: 300 });

    // Exactly the limit is remembered, and it is the newest steps: the very first move,
    // to x=500, has been dropped, so undo walks back to it and stops there.
    expect(board.drain()).toBe(UNDO_MAX_STEPS);
    expect(board.controller.canUndo()).toBe(false);
    expect(placeOf(board, id)).toEqual({ x: 500, y: 300 });
    board.cleanup();
  });

  it('TC-10 drops nothing while the history is at or under the limit', () => {
    const maxSteps = 8;
    const board = fixture({ maxSteps });
    const id = moves(board, maxSteps - 1);

    // One more step reaches the limit exactly: nothing may be thrown away yet.
    board.controller.boundary();
    moveObjects(board.doc, new Map([[id, { x: 500 + maxSteps - 1, y: 300 }]]));
    board.controller.boundary();

    expect(board.drain()).toBe(maxSteps);
    // Every step came back, so the board is back where it was loaded.
    expect(placeOf(board, id)).toEqual({ x: 300, y: 300 });
    board.cleanup();
  });

  it('TC-11 starts over when the board is opened again', () => {
    const board = fixture();
    const id = moves(board, 3);
    expect(board.controller.canUndo()).toBe(true);

    // Leaving the board takes the history with it. It was never written anywhere, so
    // coming back is the same board with no steps of any kind (`undo.session_only`).
    board.controller.destroy();
    // Destroying twice is a no-op rather than an error, because unmount and a document
    // change can both ask for it.
    expect(() => board.controller.destroy()).not.toThrow();
    expect(board.controller.canUndo()).toBe(false);
    expect(board.controller.undo()).toBe(false);
    expect(board.controller.redo()).toBe(false);

    const reopened = createUndo(board.doc);
    expect(reopened.canUndo()).toBe(false);
    expect(reopened.canRedo()).toBe(false);
    expect(reopened.undo()).toBe(false);

    // And the board is still writable afterwards, with a history of its own.
    moveObjects(board.doc, new Map([[id, { x: 999, y: 999 }]]));
    expect(reopened.canUndo()).toBe(true);
    expect(reopened.undo()).toBe(true);
    expect(placeOf(board, id)).toEqual({ x: 502, y: 300 });

    reopened.destroy();
    board.cleanup();
  });
});

describe('undo.safe: a step that can no longer be reversed', () => {
  it('TC-07 consumes the impossible step, and the rest of the history survives', () => {
    const board = fixture();
    const peer = board.peer();
    const doomed = placeNote(board, { x: 300, y: 300, text: 'doomed' });
    const kept = placeNote(board, { x: 600, y: 300, text: 'kept' });

    // I move the note; then somebody else deletes it.
    moveObjects(board.doc, new Map([[doomed, { x: 800, y: 800 }]]));
    peer.transact(() => deleteObjects(peer.doc, [doomed]));

    // Undoing my move is impossible: the note is gone, and I was not the one who deleted
    // it. Nothing visible happens, nothing is recreated, and no error is thrown.
    let applied = true;
    expect(() => {
      applied = board.controller.undo();
    }).not.toThrow();
    expect(applied).toBe(false);
    expect(placeOf(board, doomed)).toBeUndefined();
    expect(stickyOf(board, kept).text).toBe('kept');

    // The step under it was not touched by the attempt, and is still there to undo —
    // doing so does exactly the one thing that step did.
    expect(board.controller.canUndo()).toBe(true);
    expect(board.controller.undo()).toBe(true);
    expect(placeOf(board, kept)).toBeUndefined();
    expect(placeOf(board, doomed)).toBeUndefined();
    board.cleanup();
  });

  it('TC-07b undoes the rest of a group drag when one object in it has gone', () => {
    const board = fixture();
    const peer = board.peer();
    const left = placeNote(board, { x: 300, y: 300 });
    const right = placeNote(board, { x: 600, y: 300 });

    // One drag of two notes...
    board.controller.boundary();
    moveObjects(board.doc, new Map([
      [left, { x: 360, y: 360 }],
      [right, { x: 660, y: 360 }],
    ]));
    // ...and a peer deletes one of them before I press undo.
    peer.transact(() => deleteObjects(peer.doc, [right]));

    // The step still changes something, so it is undone: the note that is still there
    // goes back to where the drag began, and the deleted one stays deleted.
    expect(board.controller.undo()).toBe(true);
    expect(placeOf(board, left)).toEqual({ x: 200, y: 200 });
    expect(placeOf(board, right)).toBeUndefined();
    board.cleanup();
  });
});
