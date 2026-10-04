import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  resizeObjects,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { applyAsLoad, peer, type FakePeer } from './helpers/peer';

/**
 * One person's undo history (TC-01 to TC-11), over a real Y.Doc with a real peer on it.
 *
 * Story 8's whole claim is about whose changes a history holds. A board is a document several
 * people write into at once, so "undo" cannot mean winding the document back to how it looked -
 * that would be one person's undo reverting another person's work, which is the bug this story
 * exists to prevent. What it means instead is: apply the inverse of one of *my* changes, as a new
 * change, and let it sync like any other. Everything below is some variation on checking that
 * sentence - whose changes are remembered, what happens when the thing an inverse refers to is
 * gone, and how many steps are remembered.
 *
 * Every step is separated by the controller's own `boundary()`, which is what the app calls at the
 * ends of gestures and edits. The tests therefore say nothing about timing: the capture window is
 * `undo-boundaries.test.ts`'s business.
 */

/** The board, its history, and somebody else working on the same board. */
interface Scene {
  doc: Y.Doc;
  undo: UndoController;
  other: FakePeer;
  /** Look a note up by id, in whatever state it is in now. */
  note(id: string): ObjectSnapshot | undefined;
  /** Every note, keyed by id. */
  notes(): Map<string, ObjectSnapshot>;
}

function scene(): Scene {
  const doc = new Y.Doc();
  initDoc(doc);
  const view: Scene = {
    doc,
    undo: createUndo(doc),
    other: peer(doc),
    note: (id) => view.notes().get(id),
    notes: () => new Map(snapshot(doc).map((note) => [note.id, note])),
  };
  return view;
}

/** Put a note on the board, as its own undo step. */
function add(scene: Scene, at: { x: number; y: number }, color: StickyColor = 'yellow'): string {
  const id = createSticky(scene.doc, at, color);
  scene.undo.boundary();
  return id;
}

/** Move a note, as its own undo step. */
function move(scene: Scene, id: string, x: number, y: number): void {
  expect(moveObject(scene.doc, id, x, y)).toBe(true);
  scene.undo.boundary();
}

/**
 * How many steps this history can wind back, wound all the way back.
 *
 * The length of the stack is not exposed on purpose - a controller says whether it can undo, not
 * how much it remembers - so the way to count steps is to take them. `maxSteps` is tested through
 * this, which is also the only way to see that a dropped step is really gone rather than merely
 * hidden.
 */
function wind(scene: Scene, limit = UNDO_MAX_STEPS + 10): number {
  let steps = 0;
  while (scene.undo.undo()) {
    steps += 1;
    if (steps > limit) {
      throw new Error('undo never ran out: the stack is not being drained');
    }
  }
  return steps;
}

describe('undo history (TC-01 to TC-11)', () => {
  it('TC-01 leaves a peer\'s changes alone when it undoes my own', () => {
    const board = scene();
    // My note, and a note a peer put on the board for me to recolour.
    const mine = add(board, { x: 0, y: 0 });
    const theirs = add(board, { x: 400, y: 0 }, 'blue');
    board.undo.boundary();

    // I move my note.
    move(board, mine, 250, 120);
    // A peer creates a note of their own, and recolours the one they made first.
    board.other.apply((doc) => createSticky(doc, { x: 800, y: 400 }, 'pink'));
    board.other.apply((doc) => setStickyColor(doc, theirs, 'green'));
    expect(board.other.arrived()).toBe(2);

    expect(board.note(mine)).toMatchObject({ x: 250, y: 120 });
    board.undo.undo();

    // My note is back where it was...
    expect(board.note(mine)).toMatchObject({ x: -100, y: -100 });
    // ...the peer's new note is still on the board, and the peer's colour is still on the other
    // one. Undoing my move took back my move and nothing else, which is the negative half of this
    // test: an undo that also undid what arrived in between would be a silent edit of somebody
    // else's work.
    const notes = board.notes();
    expect([...notes.values()].filter((note) => note.color === 'pink')).toHaveLength(1);
    expect(board.note(theirs)?.color).toBe('green');
    // What is left in the history is the rest of what I did and nothing else: the two notes I put
    // on the board, which is everything I made in this session. Taking both back leaves the peer's
    // note standing - the one note here that I never made and never could undo.
    expect(wind(board)).toBe(2);
    expect([...board.notes().values()].map((note) => note.color)).toEqual(['pink']);
  });

  it('TC-02 does not remember anybody else\'s changes', () => {
    const board = scene();
    // Everything that happens to this board happens over the shoulder of somebody else.
    board.other.apply((doc) => createSticky(doc, { x: 0, y: 0 }));
    const theirs = [...board.notes().keys()][0] as string;
    board.other.apply((doc) => moveObject(doc, theirs, 300, 300));
    board.other.apply((doc) => deleteObject(doc, theirs));
    expect(board.other.arrived()).toBe(3);
    expect(board.notes().size).toBe(0);

    expect(board.undo.canUndo()).toBe(false);
    expect(board.undo.canRedo()).toBe(false);
    // The error path: undo with an empty history says so rather than pretending.
    expect(board.undo.undo()).toBe(false);
    expect(board.undo.redo()).toBe(false);
    expect(board.notes().size).toBe(0);
  });

  it('TC-03 does not remember the board it was loaded with', () => {
    const board = scene();
    // The room read the board out of storage: nine notes, arriving with the load origin.
    applyAsLoad(board.doc, (doc) => {
      for (let i = 0; i < 9; i += 1) {
        createSticky(doc, { x: i * 300, y: 0 });
      }
    });
    expect(board.notes().size).toBe(9);
    // A reload shows the board as it was left, and none of it is undoable: this session did not
    // put any of it there. Story 4 persists every update, so this is what opening a board that
    // has a history means in practice.
    expect(board.undo.canUndo()).toBe(false);
    expect(board.undo.undo()).toBe(false);

    // What I do from here is the first thing I am responsible for.
    add(board, { x: 0, y: 500 });
    expect(board.undo.canUndo()).toBe(true);
    board.undo.undo();
    expect(board.notes().size).toBe(9);
  });

  it('TC-04 brings back eight deleted notes exactly as they were', () => {
    const board = scene();
    const palette = Object.keys(STICKY_COLORS) as StickyColor[];
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const color = palette[index % palette.length] as StickyColor;
      const id = add(board, { x: index * 260, y: (index % 2) * 300 }, color);
      const text = getStickyText(board.doc, id);
      expect(text).toBeInstanceOf(Y.Text);
      // Text of my own, in my own transaction, the way the note's editor writes it.
      board.doc.transact(() => {
        text?.insert(0, `note ${String(index)}`);
      }, LOCAL_ORIGIN);
      ids.push(id);
    }
    // Give two of them a size of their own, the way a resize gesture would.
    const notes = board.notes();
    const grown = new Map<string, { x: number; y: number; width: number; height: number }>();
    ids.slice(0, 2).forEach((id) => {
      const note = notes.get(id) as ObjectSnapshot;
      grown.set(id, { x: note.x, y: note.y, width: 320, height: 240 });
    });
    expect(resizeObjects(board.doc, grown)).toBe(2);
    board.undo.boundary();

    const before = board.notes();
    expect(before.size).toBe(ids.length);
    expect(deleteObjects(board.doc, ids)).toBe(ids.length);
    board.undo.boundary();
    expect(board.notes().size).toBe(0);

    expect(board.undo.undo()).toBe(true);
    // Every note is back, with its text, colour, size and place - not an empty yellow square of
    // the default size, which is what an undo that recreated the note rather than restored it
    // would give. The delete is one step for eight notes, because one action is one step however
    // many objects it touched.
    const after = board.notes();
    expect(after.size).toBe(8);
    for (const [id, was] of before) {
      expect(after.get(id)).toEqual(was);
    }
  });

  it('TC-05 puts a moved note back and takes it again', () => {
    const board = scene();
    const id = add(board, { x: 0, y: 0 });
    const start = board.note(id) as ObjectSnapshot;

    move(board, id, 500, 400);
    expect(board.note(id)).toMatchObject({ x: 500, y: 400 });

    expect(board.undo.undo()).toBe(true);
    expect(board.note(id)).toEqual(start);
    expect(board.undo.canRedo()).toBe(true);

    expect(board.undo.redo()).toBe(true);
    expect(board.note(id)).toMatchObject({ x: 500, y: 400 });
    expect(board.undo.canRedo()).toBe(false);
    // Redo is not a second chance at something else: the note is where I dragged it, and it is
    // there for everybody, because redo is a change like any other - which is why winding the
    // history back from here takes two steps, the redo and the note's own creation, and ends with
    // the note gone. Everything I did is undoable; nothing I did not do is.
    expect(wind(board)).toBe(2);
    expect(board.notes().size).toBe(0);
  });

  it('TC-06 forgets the redo when I make a new change', () => {
    const board = scene();
    const id = add(board, { x: 0, y: 0 });
    const yellow = board.note(id) as ObjectSnapshot;

    setStickyColor(board.doc, id, 'violet');
    board.undo.boundary();
    expect(board.note(id)?.color).toBe('violet');

    expect(board.undo.undo()).toBe(true);
    expect(board.note(id)).toEqual(yellow);
    expect(board.undo.canRedo()).toBe(true);

    // A new change throws away the branch I had walked back: the board has a different future
    // now, and putting the old one back on top of it would invent a change nobody made.
    add(board, { x: 900, y: 900 }, 'blue');
    expect(board.undo.canRedo()).toBe(false);
    expect(board.undo.redo()).toBe(false);
    expect(board.note(id)?.color).toBe('yellow');
  });

  it('TC-07 does nothing when the note I moved has been deleted', () => {
    const board = scene();
    const mine = add(board, { x: 0, y: 0 });
    const stillHere = add(board, { x: 600, y: 0 });
    move(board, mine, 300, 300);

    // A peer deletes the note I had just moved, before I got to undo anything.
    board.other.apply((doc) => deleteObject(doc, mine));
    expect(board.note(mine)).toBeUndefined();

    // Undoing the move of a note that is gone does not bring it back: the peer deleted it on
    // purpose, and an undo that resurrected it would be undoing their delete, which is not mine to
    // undo. Nor does it throw, and - the part that needs saying out loud - it does not quietly go
    // on to undo the step underneath instead. A step whose inverse has nowhere to land is simply
    // forgotten, and forgetting it is not an error anybody could act on.
    expect(() => board.undo.undo()).not.toThrow();
    expect(board.note(mine)).toBeUndefined();
    expect(board.notes().size).toBe(1);
    expect(board.note(stillHere)).toMatchObject({ x: 500, y: -100 });
    // Not undone, and not redoable either: there is no change on the board that this step made.
    expect(board.undo.canRedo()).toBe(false);

    // The history still works underneath it: a move made after the dead step undoes normally, so
    // the inverse that could not be applied did not take the rest of the history with it.
    move(board, stillHere, 700, 700);
    expect(board.undo.undo()).toBe(true);
    expect(board.note(stillHere)).toMatchObject({ x: 500, y: -100 });
    expect(board.undo.canUndo()).toBe(true);
  });

  it('TC-08 restores a note with the text a peer had typed into it', () => {
    const board = scene();
    const id = add(board, { x: 0, y: 0 });
    // A peer writes in my note, then I delete it.
    board.other.apply((doc) => getStickyText(doc, id)?.insert(0, 'colleague wrote this'));
    expect(board.note(id)?.text).toBe('colleague wrote this');

    expect(deleteObject(board.doc, id)).toBe(true);
    board.undo.boundary();
    expect(board.note(id)).toBeUndefined();

    expect(board.undo.undo()).toBe(true);
    // What comes back is the note as it was when I deleted it, including the words that were not
    // mine. Undo restores a state, not a version of the note that only ever existed on my screen.
    expect(board.note(id)).toMatchObject({ text: 'colleague wrote this', color: 'yellow' });
  });

  it('TC-09 drops the oldest step once the history is full', () => {
    const board = scene();
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i += 1) {
      ids.push(add(board, { x: i * 40, y: 0 }));
    }
    expect(board.notes().size).toBe(UNDO_MAX_STEPS + 1);

    // One more step than the history keeps: the newest `UNDO_MAX_STEPS` are all there is, so
    // winding back as far as it goes takes every note but the first one I made. That first note is
    // the one that is no longer in the history at all - not hidden, not deferred, gone - which is
    // what a bounded history means, and the reason it is stated in the PRD rather than left to
    // whoever writes the undo.
    expect(wind(board)).toBe(UNDO_MAX_STEPS);
    const left = [...board.notes().keys()];
    expect(left).toEqual([ids[0]]);
  });

  it('TC-10 keeps the last step that fits', () => {
    const board = scene();
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) {
      ids.push(add(board, { x: i * 40, y: 0 }));
    }
    // Exactly full, at the boundary: nothing has been thrown away yet, so the whole board of
    // `UNDO_MAX_STEPS` notes goes back step by step and the board ends up empty.
    expect(wind(board)).toBe(UNDO_MAX_STEPS);
    expect(board.notes().size).toBe(0);
    // And it comes back the same way, one step at a time.
    let redone = 0;
    while (board.undo.redo()) {
      redone += 1;
      if (redone > UNDO_MAX_STEPS) {
        throw new Error('redo never ran out');
      }
    }
    expect(redone).toBe(UNDO_MAX_STEPS);
    expect(board.notes().size).toBe(UNDO_MAX_STEPS);
    expect([...board.notes().keys()].sort()).toEqual([...ids].sort());
  });

  it('TC-11 starts empty when the history is made again', () => {
    const board = scene();
    const id = add(board, { x: 0, y: 0 });
    move(board, id, 200, 200);
    expect(board.undo.canUndo()).toBe(true);

    // The page being reloaded: the controller is destroyed and a new one made over a document that
    // still holds everything. Undo is session-only (`undo.session_only`), so the new session can
    // see the note at 200,200 and cannot take it back - the changes it arrived with were not made
    // in this session, whichever session made them.
    const other = board.other;
    board.undo.destroy();
    other.destroy();
    const reloaded = createUndo(board.doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.canRedo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    expect(board.note(id)).toMatchObject({ x: 200, y: 200 });
    reloaded.destroy();
  });
});
