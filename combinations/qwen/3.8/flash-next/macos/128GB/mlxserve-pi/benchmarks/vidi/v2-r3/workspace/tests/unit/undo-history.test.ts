// Story 8, undo.history: TC-01 to TC-11.
//
// The whole of undo lives in a Y.UndoManager over the objects map, so these run
// against real documents: one local document whose own changes carry
// LOCAL_ORIGIN, and a second real document standing for everybody else, whose
// changes arrive with an origin that is not this tab's. What is under test is
// exactly the promise of the story — my Undo reverses my work and never
// anybody else's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getObjects,
  getStickyText,
  initDoc,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { withPeer, type Peer } from './helpers/peer';

let doc: Y.Doc;
let peer: Peer;
let undo: UndoController;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  peer = withPeer(doc);
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
  peer.destroy();
});

// --- helpers ----------------------------------------------------------------

/** Put a note on the board the way another person does. */
function peerNote(x: number, y: number, text = ''): string {
  let id = '';
  peer.transact((peerDoc) => {
    id = createSticky(peerDoc, { x, y });
    if (text !== '') getStickyText(peerDoc, id)!.insert(0, text);
  });
  undo.boundary();
  return id;
}

/** Put a note on the board myself, as its own undo step. */
function myNote(x: number, y: number, text = ''): string {
  const id = createSticky(doc, { x, y });
  if (text !== '') getStickyText(doc, id)!.insert(0, text);
  undo.boundary();
  return id;
}

function note(id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

/**
 * Where a note’s top-left is. `createSticky` is given a centre, so a note “at
 * 0,0” has its top-left elsewhere; tests ask the model rather than assume.
 */
function at(id: string): { x: number; y: number } {
  const n = note(id)!;
  return { x: n.x, y: n.y };
}

function move(id: string, x: number, y: number): void {
  moveObjects(doc, new Map([[id, { x, y }]]));
  undo.boundary();
}

/** Undo until the history runs out, and say how many steps actually applied. */
function drain(controller: UndoController): number {
  let applied = 0;
  while (controller.undo()) {
    applied++;
    controller.boundary();
    if (applied > UNDO_MAX_STEPS + 10) throw new Error('the undo history never ran out');
  }
  return applied;
}

/** Redo until the redo history runs out, and say how many steps applied. */
function redoAll(controller: UndoController): number {
  let applied = 0;
  while (controller.redo()) {
    applied++;
    controller.boundary();
    if (applied > UNDO_MAX_STEPS + 10) throw new Error('the redo history never ran out');
  }
  return applied;
}

/** `count` of my notes in varied colours, sizes and text, one step each. */
function myCluster(count: number): string[] {
  const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, { x: i * 210, y: i * 30 });
    getStickyText(doc, id)!.insert(0, `note ${i + 1}`);
    setStickyColor(doc, id, colors[i % colors.length]!);
    ids.push(id);
    undo.boundary();
  }
  // Two of them were resized, so size is part of what comes back.
  resizeObjects(doc, new Map([
    [ids[0]!, { x: 0, y: 0, width: 320, height: 240 }],
    [ids[1]!, { x: 210, y: 30, width: 120, height: 400 }],
  ]));
  undo.boundary();
  return ids;
}

// --- undo.own: only my own changes are reversed ------------------------------

describe('TC-01: undoing my change leaves everything anybody else did alone', () => {
  it('moves my note back and keeps their note and their recolour', () => {
    const mine = myNote(0, 0, 'mine');
    const mineAt = at(mine);
    const theirs = peerNote(400, 0, 'theirs');
    const theirsAt = at(theirs);
    const recoloured = peerNote(800, 0, 'shared');
    peer.transact((peerDoc) => setStickyColor(peerDoc, recoloured, 'pink'));
    undo.boundary();

    // My change: one move of my own note.
    move(mine, 100, 200);
    expect(note(mine)!.x).toBe(100);

    expect(undo.undo()).toBe(true);

    expect(note(mine)).toMatchObject({ x: mineAt.x, y: mineAt.y });
    // The note another person added is still there, with its text.
    expect(note(theirs)).toMatchObject({ x: theirsAt.x, y: theirsAt.y, text: 'theirs' });
    // And their colour change stands: undoing my move does not undo theirs.
    expect(note(recoloured)!.color).toBe('pink');
  });

  it('never reverses a peer change made on top of mine', () => {
    const mine = myNote(0, 0);
    const mineAt = at(mine);
    move(mine, 100, 0);
    peer.transact((peerDoc) => setStickyColor(peerDoc, mine, 'blue'));
    undo.boundary();

    undo.undo();

    // My move is back; their colour is not.
    expect(note(mine)!.x).toBe(mineAt.x);
    expect(note(mine)!.color).toBe('blue');
  });
});

// --- undo.own: changes that are not mine never enter the history --------------

describe('TC-02: changes made by somebody else are nothing to undo here', () => {
  it('canUndo stays false, undo does nothing, and nothing is heard', () => {
    peerNote(0, 0, 'theirs');
    peerNote(300, 0, 'theirs too');
    expect(undo.canUndo()).toBe(false);

    let changes = 0;
    const off = undo.onChange(() => changes++);
    expect(undo.undo()).toBe(false);
    peerNote(600, 0, 'and another');
    expect(changes).toBe(0);
    off();

    // Nothing was captured, so nothing was reversed: all three notes are intact.
    expect(snapshot(doc)).toHaveLength(3);
    expect(undo.canRedo()).toBe(false);
  });

  it('a peer change after my own adds no step and is never reversed', () => {
    const theirs = peerNote(0, 0, 'theirs');
    const theirsAt = at(theirs);
    const mine = myNote(300, 0);

    // They move their own note.
    peer.transact((peerDoc) => moveObjects(peerDoc, new Map([[theirs, { x: 50, y: 60 }]])));
    undo.boundary();

    // Exactly one step is in here, and it is mine.
    expect(drain(undo)).toBe(1);
    expect(getObjects(doc).has(mine)).toBe(false); // my note, undone by my Undo
    expect(at(theirs)).not.toEqual(theirsAt); // their move stands, untouched
    expect(undo.canUndo()).toBe(false);
  });
});

describe('TC-03: an update applied while opening the board is not mine to undo', () => {
  it('a board handed over on open leaves the history empty', () => {
    // The board as another tab saved it, handed over on opening (story 4's load).
    const saved = new Y.Doc();
    initDoc(saved);
    const id = createSticky(saved, { x: 0, y: 0 });
    getStickyText(saved, id)!.insert(0, 'already here');
    const update = Y.encodeStateAsUpdate(saved);
    saved.destroy();

    peer.applyLoad(update);

    expect(getObjects(doc).has(id)).toBe(true);
    expect(note(id)!.text).toBe('already here');
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('an update that arrives later with the same origin is untracked too', () => {
    const mine = myNote(0, 0);
    expect(undo.canUndo()).toBe(true);

    // A board state handed over from elsewhere, after I had already done something.
    const elsewhere = new Y.Doc();
    initDoc(elsewhere);
    const theirs = createSticky(elsewhere, { x: 900, y: 900 });
    peer.applyLoad(Y.encodeStateAsUpdate(elsewhere));
    elsewhere.destroy();

    expect(getObjects(doc).has(theirs)).toBe(true);
    // Exactly one step is mine: the loaded note is not one to undo.
    expect(drain(undo)).toBe(1);
    expect(getObjects(doc).has(theirs)).toBe(true);
    expect(getObjects(doc).has(mine)).toBe(false);
  });
});

// --- undo.steps: meaningful steps ---------------------------------------------

describe('TC-04: one delete of eight notes is one step that brings all eight back', () => {
  it('restores each note with its text, colour, size and position', () => {
    const ids = myCluster(8);
    const before = snapshot(doc);

    expect(deleteObjects(doc, ids)).toBe(8);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);

    const after = new Map(snapshot(doc).map((n) => [n.id, n]));
    expect(after.size).toBe(8);
    for (const was of before) {
      expect(after.get(was.id)).toEqual(was);
    }
    // The whole delete was one press; what is left are the older steps of mine.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true); // my resize, which the delete did not join
    expect(note(ids[0]!)!.width).toBeUndefined();
  });

  it('does nothing when there is nothing left to undo', () => {
    const ids = myCluster(3);
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    // A fresh controller has no history of its own: the button is disabled and
    // the keyboard shortcut reverses nothing.
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(0);
    fresh.destroy();
  });

  it('is one press of Undo whatever the number of objects', () => {
    const ids = myCluster(8);
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(8);
  });
});

describe('TC-05: redo re-applies my most recently undone change', () => {
  it('puts the position back exactly where it was', () => {
    const mine = myNote(0, 0);
    const mineAt = at(mine);
    move(mine, 320, -140);

    undo.undo();
    expect(note(mine)).toMatchObject({ x: mineAt.x, y: mineAt.y });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(note(mine)).toMatchObject({ x: 320, y: -140 });
    expect(undo.canRedo()).toBe(false);
  });

  it('a redo of my delete takes the notes away again', () => {
    const ids = myCluster(3);
    deleteObjects(doc, ids);
    undo.boundary();
    undo.undo();
    expect(snapshot(doc)).toHaveLength(3);

    expect(undo.redo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('TC-06: a new change of mine clears what I could have redone', () => {
  it('leaves canRedo false once I do something new', () => {
    const mine = myNote(0, 0);
    const other = myNote(500, 0);
    move(mine, 100, 100);

    undo.undo();
    expect(undo.canRedo()).toBe(true);

    // A new change of my own, not a redo.
    move(other, 600, 600);

    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });
});

// --- undo.safe: an undo whose target somebody else deleted ---------------------

describe('TC-07: undoing a move of a note another person has deleted', () => {
  it('throws nothing, invents nothing and leaves the rest of the history usable', () => {
    const theirs = peerNote(0, 0, 'theirs'); // their note, which I moved
    const mine = myNote(400, 0, 'mine'); // my own note, an older step

    move(theirs, 500, 500);

    // They delete their own note while I am not looking.
    peer.transact((peerDoc) => getObjects(peerDoc).delete(theirs));
    expect(getObjects(doc).has(theirs)).toBe(false);

    // My Undo has nothing to put back. It must not throw, and must not invent a
    // note I never deleted; it goes on with my own work instead.
    let applied: boolean | undefined;
    expect(() => {
      applied = undo.undo();
    }).not.toThrow();
    expect(applied).toBe(true); // my own older step, not their delete
    expect(getObjects(doc).has(theirs)).toBe(false);
    expect(getObjects(doc).has(mine)).toBe(false);

    // The dead step was consumed rather than jamming the history.
    expect(undo.canUndo()).toBe(false);
    expect(() => undo.undo()).not.toThrow();
    expect(undo.undo()).toBe(false);
  });

  it('reports nothing to undo when the dead step was the only step', () => {
    const theirs = peerNote(0, 0);
    move(theirs, 200, 0);
    peer.transact((peerDoc) => getObjects(peerDoc).delete(theirs));

    expect(() => undo.undo()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(getObjects(doc).has(theirs)).toBe(false);
    // Nothing was applied, so there is nothing to redo either.
    expect(undo.canRedo()).toBe(false);
  });
});

// --- undo.safe: my delete of a note somebody else was editing ------------------

describe('TC-08: undoing my delete of a note another person was editing', () => {
  it('brings the note back with the content it had at the moment I deleted it', () => {
    const mine = myNote(0, 0, 'draft');

    // Somebody else adds to that note while I am looking at it.
    peer.transact((peerDoc) => getStickyText(peerDoc, mine)!.insert(5, ' — reviewed'));
    expect(note(mine)!.text).toBe('draft — reviewed');

    // I delete it, then undo my delete.
    deleteObjects(doc, [mine]);
    undo.boundary();
    expect(undo.undo()).toBe(true);

    expect(note(mine)!.text).toBe('draft — reviewed');
    // And what I deleted, and only what I deleted, came back.
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('restores the note I deleted with their words in it, and leaves their own delete standing', () => {
    const mine = myNote(0, 0, 'text');
    const theirs = peerNote(400, 0, 'theirs');

    deleteObjects(doc, [mine]);
    undo.boundary();
    // While it is gone, they delete their own note.
    peer.transact((peerDoc) => deleteObjects(peerDoc, [theirs]));

    expect(() => undo.undo()).not.toThrow();
    // What I deleted comes back, content and all; what they deleted does not.
    expect(note(mine)!.text).toBe('text');
    expect(getObjects(doc).has(theirs)).toBe(false);
  });
});

// --- undo.limit: the history holds UNDO_MAX_STEPS steps ------------------------

describe('TC-09: a full history drops its oldest step when a new one arrives', () => {
  it('holds exactly UNDO_MAX_STEPS steps and forgets the first', () => {
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) ids.push(myNote(i * 300, 0));
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    expect(drain(undo)).toBe(UNDO_MAX_STEPS);
    // The very first note is the one that fell off the front of the history.
    expect(getObjects(doc).has(ids[0]!)).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });
});

describe('TC-10: a history one step short of its limit drops nothing', () => {
  it('keeps every step when the newest one fills it exactly', () => {
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) ids.push(myNote(i * 300, 0));
    ids.push(myNote(UNDO_MAX_STEPS * 300, 0));
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);

    expect(drain(undo)).toBe(UNDO_MAX_STEPS);
    // Nothing fell off the history: the first note is off the board, and comes back.
    expect(redoAll(undo)).toBe(UNDO_MAX_STEPS);
    expect(getObjects(doc).has(ids[0]!)).toBe(true);
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);
  });
});

// --- undo.session_only: the history does not survive a reload ------------------

describe('TC-11: destroying the controller throws the history away', () => {
  it('leaves a fresh controller with nothing to undo', () => {
    const mine = myNote(0, 0);
    move(mine, 40, 40);
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const reloaded = createUndo(doc);

    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.canRedo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    // The board itself is untouched: only the history went away.
    expect(note(mine)).toMatchObject({ x: 40, y: 40 });
    undo = reloaded;
  });

  it('stops hearing the document, so nothing made after is remembered', () => {
    const seen: string[] = [];
    const off = undo.onChange(() => seen.push('change'));
    undo.destroy();
    off();

    createSticky(doc, { x: 0, y: 0 });
    expect(seen).toEqual([]);
  });
});

// --- the contract’s other promises ---------------------------------------------

describe('onChange, boundary, addScope and empty stacks', () => {
  it('reports every change of the two stacks and stops after unsubscribe', () => {
    const state = (): string => `${undo.canUndo() ? 'u' : '-'}${undo.canRedo() ? 'r' : '-'}`;
    const seen: string[] = [];
    const off = undo.onChange(() => seen.push(state()));

    const mine = myNote(0, 0); // a step of my own
    expect(seen).toContain('u-');

    undo.undo(); // now there is something to redo
    expect(seen).toContain('-r');

    off();
    const heard = seen.length;
    move(mine, 10, 10);
    expect(seen).toHaveLength(heard);
  });

  it('closes a capture window so the next change is its own step', () => {
    const mine = myNote(0, 0);
    const mineAt = at(mine);
    move(mine, 10, 0);
    move(mine, 20, 0); // its own step, because move() closed the window
    expect(undo.undo()).toBe(true);
    expect(note(mine)!.x).toBe(10);
    expect(undo.undo()).toBe(true);
    expect(note(mine)!.x).toBe(mineAt.x);
  });

  it('merges changes made inside the capture window into one step', () => {
    const mine = myNote(0, 0);
    const mineAt = at(mine);
    // The 30 frames of one drag, with no boundary between them.
    for (let i = 1; i <= 30; i++) moveObjects(doc, new Map([[mine, { x: mineAt.x + i, y: 0 }]]));
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(note(mine)!.x).toBe(mineAt.x);
    // What is left is the note’s own creation, not one frame of the drag.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(getObjects(doc).has(mine)).toBe(false);
    expect(undo.canUndo()).toBe(false);
  });

  it('says false on empty stacks and takes a boundary on them quietly', () => {
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });

  it('covers a scope added later, the way story 16 adds comments', () => {
    const comments = doc.getMap<Y.Map<unknown>>('comments');
    // The contract’s parameter is AbstractType<unknown>; yjs types are invariant,
    // so a real typed map has to be widened at the call site.
    undo.addScope(comments as unknown as Y.AbstractType<unknown>);

    // Written the way the model writes: as one of this tab’s own transactions.
    doc.transact(() => comments.set('c1', new Y.Map()), LOCAL_ORIGIN);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    expect(comments.has('c1')).toBe(false);
  });

  it('leaves an origin it does not track out of the history, whatever it is', () => {
    // Somebody else's own changes: the provider origin (story 3), the load
    // origin (story 4). Neither is mine, so neither is ever undoable here.
    const saved = new Y.Doc();
    initDoc(saved);
    createSticky(saved, { x: 0, y: 0 });
    peer.applyLoad(Y.encodeStateAsUpdate(saved));
    saved.destroy();
    expect(undo.canUndo()).toBe(false);
    expect(drain(undo)).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});
