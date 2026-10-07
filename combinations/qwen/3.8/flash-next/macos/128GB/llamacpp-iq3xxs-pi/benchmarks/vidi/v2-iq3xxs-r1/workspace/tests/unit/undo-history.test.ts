import { afterEach, describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { emptyDoc, noteShape, retroSpecs, seed } from './undo-fixture';
import { applyLoadedBoard, connectPeer, type Peer } from './peer';
import * as Y from 'yjs';

/**
 * Story 8 — per-user undo history (undo.history).
 *
 * TC-01 to TC-11 run a real `Y.Doc` and a real `Y.UndoManager` behind the
 * controller, with a second real document as the colleague (design "Mock vs real
 * boundaries"): the point of every case is which changes the history ever sees.
 */

const open: Array<{ close: () => void }> = [];

function history(doc: Y.Doc, opts?: Parameters<typeof createUndo>[1]): UndoController {
  const controller = createUndo(doc, opts);
  open.push({ close: () => controller.destroy() });
  return controller;
}

function joinPeer(local: Y.Doc): Peer {
  const peer = connectPeer(local);
  open.push({ close: () => peer.destroy() });
  return peer;
}

afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

/** Board with three plain notes at known places (not part of any history). */
function threeNotes(): { doc: Y.Doc; ids: string[] } {
  const doc = emptyDoc();
  const ids = seed(doc, [
    { x: 100, y: 100, color: 'yellow', text: 'first' },
    { x: 400, y: 100, color: 'blue', text: 'second' },
    { x: 700, y: 100, color: 'green', text: 'third' },
  ]);
  return { doc, ids };
}

describe('undo.history — whose changes are in the history', () => {
  // TC-01: my move is undone; the colleague's new note and recolour stay (negative).
  it('TC-01 undoes my move and none of the colleague’s changes', () => {
    const { doc, ids } = threeNotes();
    const [moved, untouched, recoloured] = ids as [string, string, string];
    const ctrl = history(doc);
    const peer = joinPeer(doc);

    ctrl.boundary();
    moveObject(doc, moved, 900, 900);
    ctrl.boundary();

    peer.transact(() => {
      createSticky(peer.doc, { x: 60, y: 600 }, 'pink');
      setStickyColor(peer.doc, recoloured, 'violet');
    });

    expect(ctrl.canUndo()).toBe(true);
    expect(ctrl.undo()).toBe(true);

    const after = snapshot(doc);
    const mine = after.find((n) => n.id === moved)!;
    expect({ x: mine.x, y: mine.y }).toEqual({ x: 100, y: 100 });
    // The colleague's work stands untouched.
    expect(after).toHaveLength(4);
    expect(after.find((n) => n.id === recoloured)!.color).toBe('violet');
    expect(snapshot(doc).filter((n) => n.id === untouched)).toHaveLength(1);
    // Only my own single step was ever in the history.
    expect(ctrl.canUndo()).toBe(false);
  });

  // TC-02: a board I never touched has nothing to undo (negative).
  it('TC-02 offers nothing when only the colleague changed the board', () => {
    const { doc } = threeNotes();
    const ctrl = history(doc);
    const peer = joinPeer(doc);

    peer.transact(() => {
      createSticky(peer.doc, { x: 20, y: 20 }, 'orange');
      setStickyColor(peer.doc, 'no-such-note', 'green');
    });

    expect(snapshot(doc)).toHaveLength(4);
    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.undo()).toBe(false);
    expect(ctrl.redo()).toBe(false);
  });

  // TC-03: a board that arrived as load updates is not my work either (negative).
  it('TC-03 ignores the updates a saved board arrives with', () => {
    const saved = emptyDoc();
    seed(saved, [
      { x: 100, y: 100, color: 'yellow', text: 'saved one' },
      { x: 400, y: 100, color: 'blue', text: 'saved two' },
    ]);

    const doc = emptyDoc();
    applyLoadedBoard(doc, saved);
    const ctrl = history(doc);

    expect(snapshot(doc)).toHaveLength(2);
    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.undo()).toBe(false);

    // From here on, my own change is undoable.
    ctrl.boundary();
    createSticky(doc, { x: 900, y: 100 }, 'green');
    ctrl.boundary();
    expect(ctrl.canUndo()).toBe(true);
    expect(ctrl.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(2);
  });
});

describe('undo.history — steps and their inverse', () => {
  // TC-04: one Delete of 8 notes; one undo brings all 8 back, whole.
  it('TC-04 restores every deleted note with its text, colour, size and place', () => {
    const doc = emptyDoc();
    const ids = seed(doc, retroSpecs());
    const cluster = ids.slice(0, 8);
    const before = snapshot(doc)
      .filter((n) => cluster.includes(n.id))
      .map(noteShape);
    const ctrl = history(doc);

    ctrl.boundary();
    expect(deleteObjects(doc, cluster)).toBe(8);
    ctrl.boundary();

    expect(snapshot(doc)).toHaveLength(4);
    expect(ctrl.undo()).toBe(true);

    const after = snapshot(doc)
      .filter((n) => cluster.includes(n.id))
      .map(noteShape);
    expect(after).toEqual(before);
    expect(snapshot(doc)).toHaveLength(12);
  });

  // TC-05: undo then redo re-applies my step.
  it('TC-05 re-applies the undone move on redo', () => {
    const { doc, ids } = threeNotes();
    const ctrl = history(doc);

    ctrl.boundary();
    moveObject(doc, ids[0], 60, 420);
    ctrl.boundary();

    expect(ctrl.undo()).toBe(true);
    expect(snapshot(doc).find((n) => n.id === ids[0])!).toMatchObject({ x: 100, y: 100 });
    expect(ctrl.canRedo()).toBe(true);

    expect(ctrl.redo()).toBe(true);
    expect(snapshot(doc).find((n) => n.id === ids[0])!).toMatchObject({ x: 60, y: 420 });
    expect(ctrl.canRedo()).toBe(false);
  });

  // TC-06: a new change after undoing throws the redo history away.
  it('TC-06 clears redo when a new change follows an undo', () => {
    const { doc, ids } = threeNotes();
    const ctrl = history(doc);

    ctrl.boundary();
    moveObject(doc, ids[0], 60, 420);
    ctrl.boundary();
    expect(ctrl.undo()).toBe(true);
    expect(ctrl.canRedo()).toBe(true);

    ctrl.boundary();
    setStickyColor(doc, ids[1], 'pink');
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);
    expect(ctrl.redo()).toBe(false);
  });

  // TC-07: the note I moved is gone by the time I undo the move — nothing breaks.
  it('TC-07 survives undoing a move of a note the colleague deleted', () => {
    const { doc, ids } = threeNotes();
    const [moved] = ids as [string];
    const ctrl = history(doc);
    const peer = joinPeer(doc);

    ctrl.boundary();
    const noteC = createSticky(doc, { x: 40, y: 900 }, 'pink');
    ctrl.boundary();
    const noteD = createSticky(doc, { x: 80, y: 900 }, 'violet');
    ctrl.boundary();
    moveObject(doc, moved, 700, 700);
    ctrl.boundary();

    peer.transact(() => deleteObjects(peer.doc, [moved]));
    expect(snapshot(doc).find((n) => n.id === moved)).toBeUndefined();

    // Undoing my move targets a note that no longer exists: no error and nothing is
    // brought back. The dead step is skipped, and the step before it is reversed in
    // the same call — the history stays usable rather than jamming on a ghost.
    expect(() => ctrl.undo()).not.toThrow();
    expect(snapshot(doc).find((n) => n.id === moved)).toBeUndefined();
    expect(snapshot(doc).find((n) => n.id === noteD)).toBeUndefined();
    // The rest of my history is still usable.
    expect(ctrl.canUndo()).toBe(true);
    expect(ctrl.undo()).toBe(true);
    expect(snapshot(doc).find((n) => n.id === noteC)).toBeUndefined();
    expect(snapshot(doc).find((n) => n.id === moved)).toBeUndefined();
    expect(ctrl.undo()).toBe(false);
  });

  // TC-08: I delete a note the colleague was editing; undo returns it as it was then.
  it('TC-08 restores my deleted note with the content it held when I deleted it', () => {
    const { doc, ids } = threeNotes();
    const [target] = ids as [string];
    const ctrl = history(doc);
    const peer = joinPeer(doc);

    peer.transact(() => {
      getStickyText(peer.doc, target)?.insert(0, 'raj: ');
    });
    const atDelete = snapshot(doc).find((n) => n.id === target)!;
    const shape = noteShape(atDelete);
    expect(shape.text).toBe('raj: first');

    ctrl.boundary();
    deleteObjects(doc, [target]);
    ctrl.boundary();
    expect(snapshot(doc).find((n) => n.id === target)).toBeUndefined();

    expect(ctrl.undo()).toBe(true);
    const restored = snapshot(doc).find((n) => n.id === target);
    expect(noteShape(restored!)).toEqual(shape);
  });
});

describe('undo.history — length and lifetime', () => {
  // TC-09: at the limit, the oldest step is dropped.
  it('TC-09 keeps exactly the newest UNDO_MAX_STEPS steps', () => {
    const doc = emptyDoc();
    const ctrl = history(doc);

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ctrl.boundary();
      ids.push(createSticky(doc, { x: i, y: 0 }, 'yellow'));
    }
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    let undone = 0;
    while (undone < UNDO_MAX_STEPS + 5 && ctrl.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    // The very first note is beyond the history and stays where it is.
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.id).toBe(ids[0]);
  });

  // TC-10: just below the limit nothing is dropped (boundary value).
  it('TC-10 drops nothing at UNDO_MAX_STEPS - 1 steps', () => {
    const doc = emptyDoc();
    const ctrl = history(doc);

    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      ctrl.boundary();
      createSticky(doc, { x: i, y: 0 }, 'yellow');
    }
    ctrl.boundary();
    createSticky(doc, { x: UNDO_MAX_STEPS, y: 0 }, 'yellow');
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);

    let undone = 0;
    while (undone < UNDO_MAX_STEPS + 5 && ctrl.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-11: the history lives and dies with the tab (session only).
  it('TC-11 starts empty after the controller is thrown away', () => {
    const { doc, ids } = threeNotes();
    const ctrl = history(doc);

    ctrl.boundary();
    moveObject(doc, ids[0], 33, 77);
    ctrl.boundary();
    expect(ctrl.canUndo()).toBe(true);

    ctrl.destroy();
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    // The board itself is unchanged — only the history went away.
    expect(snapshot(doc).find((n) => n.id === ids[0])!).toMatchObject({ x: 33, y: 77 });
    fresh.destroy();
  });
});
