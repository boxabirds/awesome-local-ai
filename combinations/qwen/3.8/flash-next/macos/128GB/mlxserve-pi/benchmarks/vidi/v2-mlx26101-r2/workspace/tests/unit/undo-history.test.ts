/**
 * The per-person undo history, against a colleague who is really there
 * (`tests/unit/undo-history.test.ts`, PRD `undo.history`, TC-01 to TC-11).
 *
 * Every case here is the same argument in a different shape: the history holds
 * this tab's own transactions and nothing else. That is worth stating because it
 * is the one thing about undo on a shared board that can be get fatally wrong -
 * a history that steps the *board* back in time would delete a colleague's work
 * every time someone undoes their own typo - and the only way to test it is to
 * have a colleague, which `./peer.js` provides as a second real document kept in
 * step with the first.
 *
 * The fixture in each case is built before the controller exists, which is what a
 * board actually is: story 4 loads the notes into the document and only then does
 * the client start keeping a history of what happens next. A history created at
 * the beginning of the test and pointed at a document it then filled with notes
 * would be a history that offers to undo the board's own contents.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createUndo } from '../../src/client/board/undo.js';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.js';
import { STICKY_SIZE_WORLD, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config.js';
import { applyLoaded, createPeer } from './peer.js';

/* ------------------------------------------------------------- local helpers */

/** An empty board, as a client holds it. */
const newBoard = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

/** Make a note at a world point (its centre), as the toolbar's button does. */
const add = (doc: Y.Doc, at = { x: 0, y: 0 }, color: StickyColor = 'yellow'): string => {
  const id = createSticky(doc, at, color);
  if (typeof id !== 'string') throw new Error('the model refused to make a note');
  return id;
};

/** Type into a note the way the note's own editor does. */
const type = (doc: Y.Doc, id: string, text: string): void => {
  const ytext = getStickyText(doc, id);
  if (!ytext) throw new Error(`note ${id} has no text to type into`);
  doc.transact(() => {
    ytext.insert(ytext.length, text);
  }, LOCAL_ORIGIN);
};

/** The board's notes, by id, as the client sees them. */
const byId = (doc: Y.Doc): Map<string, StickySnapshot> =>
  new Map(snapshot(doc).map((note) => [note.id, note]));

/** The note's position and size, as one comparable string. */
const place = (note: StickySnapshot): string =>
  `${note.x},${note.y},${note.width ?? 'default'},${note.height ?? 'default'}`;

/**
 * One step per call, whatever the clock says: the boundaries a real board puts
 * around a toolbar action, so a test that makes three notes gets three undo steps
 * rather than one burst that happened to be typed quickly.
 */
function stepEveryChange(doc: Y.Doc): {
  undo: ReturnType<typeof createUndo>;
  make(at?: { x: number; y: number }, color?: StickyColor): string;
} {
  const undo = createUndo(doc);
  return {
    undo,
    make(at = { x: 0, y: 0 }, color: StickyColor = 'yellow') {
      undo.boundary();
      const id = add(doc, at, color);
      undo.boundary();
      return id;
    },
  };
}

/* -------------------------------------------- TC-01: only my own changes, ever */

describe('undo reverses my change and no one else’s (TC-01)', () => {
  it('leaves a note a colleague made, and a colour they gave it', () => {
    const doc = newBoard();
    const peer = createPeer(doc);
    const mine = add(doc, { x: 100, y: 100 });
    const shared = add(doc, { x: 500, y: 100 }, 'pink');
    const undo = createUndo(doc);

    // I move my note.
    const before = byId(doc).get(mine)!;
    undo.boundary();
    moveObject(doc, mine, before.x - 120, before.y + 40);
    undo.boundary();

    // A colleague makes a note of their own and recolours one of ours.
    const theirs = peer.transact(() => {
      const id = add(peer.doc, { x: 100, y: 500 });
      setStickyColor(peer.doc, shared, 'blue');
      return id;
    });

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    const notes = byId(doc);
    // Mine is back where it started.
    expect(place(notes.get(mine)!)).toBe(place(before));
    // Theirs is still there, and their colour is still on the note they touched.
    expect(notes.has(theirs)).toBe(true);
    expect(notes.get(shared)!.color).toBe('blue');
    // One step was undone, so one is available to redo, and only that one.
    expect(undo.canRedo()).toBe(true);
    peer.destroy();
  });

  it('is the same on the colleague’s screen: my undo is an ordinary change', () => {
    const doc = newBoard();
    const peer = createPeer(doc);
    const mine = add(doc, { x: 100, y: 100 });
    const undo = createUndo(doc);
    const before = place(byId(doc).get(mine)!);

    undo.boundary();
    moveObject(doc, mine, -300, -300);
    undo.boundary();
    expect(place(byId(peer.doc).get(mine)!)).not.toBe(before);

    undo.undo();
    // They see my note come back on its own, because the inverse is a change like
    // any other and goes out over the same socket.
    expect(place(byId(peer.doc).get(mine)!)).toBe(before);
    peer.destroy();
  });
});

/* ----------------------------- TC-02 / TC-03: changes that are not mine at all */

describe('a history of changes that are not mine (TC-02, TC-03)', () => {
  it('has nothing to undo when everything on it came from a colleague (TC-02)', () => {
    const doc = newBoard();
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    peer.transact(() => {
      add(peer.doc, { x: 0, y: 0 });
      add(peer.doc, { x: 200, y: 0 });
    });

    expect(snapshot(doc)).toHaveLength(2);
    // The screen is full of other people's work and there is nothing to undo -
    // which is the whole story of this feature, in one assertion.
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
    peer.destroy();
  });

  it('has nothing to undo when the board was loaded out of storage (TC-03)', () => {
    const stored = newBoard();
    const first = add(stored, { x: 0, y: 0 }, 'blue');
    const second = add(stored, { x: 300, y: 0 }, 'pink');
    type(stored, first, 'a note that is already here');

    const doc = newBoard();
    const undo = createUndo(doc);
    // Story 4: the room hands the board over as one update it read from storage.
    applyLoaded(doc, Y.encodeStateAsUpdate(stored));

    expect(snapshot(doc)).toHaveLength(2);
    expect(byId(doc).get(first)!.text).toBe('a note that is already here');
    // None of it is mine to undo.
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    // And my own first change is the first thing in the history.
    undo.boundary();
    deleteObjects(doc, [second]);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(2);
  });
});

/* ------------------------- TC-04: a delete of many things comes back as one */

describe('undoing my delete (TC-04)', () => {
  it('brings back all eight notes with their text, colour, size and position', () => {
    const doc = newBoard();
    const colors: StickyColor[] = ['yellow', 'pink', 'blue', 'violet'];
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const id = add(doc, { x: 120 * index, y: 90 * (index % 3) }, colors[index % colors.length]!);
      type(doc, id, `note ${index}`);
      ids.push(id);
    }
    const undo = createUndo(doc);
    const before = byId(doc);
    const expected = ids.map((id) => ({
      id,
      text: before.get(id)!.text,
      color: before.get(id)!.color,
      place: place(before.get(id)!),
    }));

    // One accidental Delete on a selection of eight.
    undo.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);

    const after = byId(doc);
    expect(after.size).toBe(8);
    for (const note of expected) {
      const restored = after.get(note.id);
      expect(restored?.text).toBe(note.text);
      expect(restored?.color).toBe(note.color);
      expect(restored ? place(restored) : '').toBe(note.place);
    }
    // Nothing else about it: eight notes back is eight notes, not sixteen.
    expect(snapshot(doc)).toHaveLength(8);
  });
});

/* --------------------------------------------- TC-05 to TC-08: the stack's life */

describe('redo (TC-05, TC-06)', () => {
  it('re-applies what I just undid (TC-05)', () => {
    const doc = newBoard();
    const id = add(doc, { x: 400, y: 200 });
    const undo = createUndo(doc);
    const start = place(byId(doc).get(id)!);

    undo.boundary();
    moveObject(doc, id, 720, 260);
    undo.boundary();

    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(true);
    expect(place(byId(doc).get(id)!)).toBe(start);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(place(byId(doc).get(id)!)).toBe(`720,260,${STICKY_SIZE_WORLD},${STICKY_SIZE_WORLD}`);
    expect(undo.canRedo()).toBe(false);
    // Undoing the redo is available again: the step is still a step.
    expect(undo.canUndo()).toBe(true);
  });

  it('is thrown away by the next thing I do, and says so (TC-06)', () => {
    const doc = newBoard();
    const id = add(doc, { x: 0, y: 0 }, 'yellow');
    const undo = createUndo(doc);

    undo.boundary();
    setStickyColor(doc, id, 'blue');
    undo.boundary();

    let notified = 0;
    const unsubscribe = undo.onChange(() => {
      notified += 1;
    });

    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);
    expect(notified).toBeGreaterThan(0);

    // A new change of mine: the redo is gone, because a board that has moved on
    // has nothing left to re-apply.
    const before = notified;
    undo.boundary();
    moveObject(doc, id, 100, 100);
    undo.boundary();
    expect(undo.canRedo()).toBe(false);
    expect(notified).toBeGreaterThan(before);
    expect(undo.redo()).toBe(false);

    // Unsubscribing is real: the toolbar unmounts, and its listener goes quiet.
    unsubscribe();
    const quiet = notified;
    let heard = 0;
    undo.onChange(() => {
      heard += 1;
    });
    undo.boundary();
    setStickyColor(doc, id, 'violet');
    undo.boundary();
    expect(notified).toBe(quiet);
    // and the controller still tells anyone who is still listening.
    expect(heard).toBeGreaterThan(0);
  });
});

describe('undoing something that is no longer there (TC-07, TC-08)', () => {
  it('does nothing when a colleague deleted what my move was about (TC-07)', () => {
    const doc = newBoard();
    const mine = add(doc, { x: 0, y: 0 });
    const also = add(doc, { x: 400, y: 0 });
    const further = add(doc, { x: 800, y: 0 });
    const undo = createUndo(doc);
    /** Where one of the three notes is, by name. */
    const names = new Map<string, string>([
      [mine, 'mine'],
      [also, 'also'],
      [further, 'further'],
    ]);
    const where = (): string =>
      snapshot(doc)
        .map((note) => `${names.get(note.id)}@${note.x},${note.y}`)
        .sort()
        .join(' ');

    undo.boundary();
    moveObject(doc, also, 40, 60);
    undo.boundary();
    undo.boundary();
    moveObject(doc, further, 80, 120);
    undo.boundary();
    undo.boundary();
    moveObject(doc, mine, 30, 30);
    undo.boundary();
    expect(where()).toBe('also@40,60 further@80,120 mine@30,30');

    // They delete the note I had just moved.
    peerDelete(doc, mine);
    expect(snapshot(doc)).toHaveLength(2);

    // My undo has nothing to put back: the note is gone by their hand, and
    // bringing back the position I gave it would bring back a board they have
    // already cleared. yjs does not stop at a step that has nothing to do - it
    // drops that step and goes on to the last thing it *can* take back - so one
    // undo here takes back the move before it as well. What must not happen is an
    // error, or the deleted note coming back because I once moved it.
    let undone = false;
    expect(() => {
      undone = undo.undo();
    }).not.toThrow();
    expect(undone).toBe(true);
    expect(snapshot(doc).some((note) => note.id === mine)).toBe(false);
    expect(where()).toBe('also@40,60 further@700,-100');

    // and the rest of the history is still a history: the next undo works, and
    // takes back the step before that one, no further and no less.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(where()).toBe('also@300,-100 further@700,-100');
    expect(snapshot(doc).some((note) => note.id === mine)).toBe(false);
  });

  it('brings back my deleted note with what a colleague had just typed into it (TC-08)', () => {
    const doc = newBoard();
    const peer = createPeer(doc);
    const id = add(doc, { x: 0, y: 0 });
    type(doc, id, 'my own words');

    peer.transact(() => {
      const theirs = getStickyText(peer.doc, id);
      if (theirs) theirs.insert(theirs.length, ' and Raj’s');
    });
    expect(byId(doc).get(id)!.text).toBe('my own words and Raj’s');

    const undo = createUndo(doc);
    undo.boundary();
    deleteObjects(doc, [id]);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    // The note comes back as it was at the moment I deleted it - including the
    // part I did not write. Undoing my delete is not undoing their typing.
    expect(byId(doc).get(id)!.text).toBe('my own words and Raj’s');
    expect(byId(peer.doc).get(id)!.text).toBe('my own words and Raj’s');
    peer.destroy();
  });
});

/** A colleague deletes one note, as they would from their own toolbar. */
function peerDelete(local: Y.Doc, id: string): void {
  const peer = createPeer(local);
  peer.transact(() => {
    deleteObjects(peer.doc, [id]);
  });
  peer.destroy();
}

/* ---------------------------------------------- TC-09 / TC-10: the history's length */

describe('the length of the history (TC-09, TC-10)', () => {
  it('keeps the newest 200 steps and drops the oldest (TC-09)', () => {
    const doc = newBoard();
    const { undo, make } = stepEveryChange(doc);

    const ids: string[] = [];
    for (let index = 0; index <= UNDO_MAX_STEPS; index += 1) {
      ids.push(make({ x: index * 10, y: 0 }));
    }
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    // Exactly the setting's worth of undos are available; the step that fell off
    // the front is the first note, which is the one that stays.
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    const left = byId(doc);
    expect(left.size).toBe(1);
    expect(left.has(ids[0]!)).toBe(true);
    for (const id of ids.slice(1)) expect(left.has(id)).toBe(false);
  });

  it('drops nothing at the boundary itself (TC-10)', () => {
    const doc = newBoard();
    const { undo, make } = stepEveryChange(doc);

    const ids: string[] = [];
    for (let index = 0; index < UNDO_MAX_STEPS - 1; index += 1) ids.push(make({ x: index * 10, y: 0 }));
    ids.push(make({ x: UNDO_MAX_STEPS * 10, y: 0 }));

    // Exactly 200 steps, all of them still there: the limit discards when the
    // history *holds* 200 and one more arrives, not as soon as it reaches it.
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.canUndo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(0);

    // and all 200 are still there to redo.
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      expect(undo.redo()).toBe(true);
    }
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);
    expect(ids).toHaveLength(UNDO_MAX_STEPS);
  });
});

/* ------------------------------------------------------- TC-11: this visit only */

describe('a history of this visit only (TC-11)', () => {
  it('starts empty again after the board is closed and opened', () => {
    const doc = newBoard();
    const first = createUndo(doc);
    const id = add(doc, { x: 0, y: 0 });
    first.boundary();
    moveObject(doc, id, 500, 500);
    first.boundary();
    expect(first.canUndo()).toBe(true);

    // Closing the board: the controller goes with it. The board keeps the note and
    // the position it was left in, because undo was never a thing stored anywhere.
    first.destroy();
    const after = createUndo(doc);
    expect(after.canUndo()).toBe(false);
    expect(after.canRedo()).toBe(false);
    expect(after.undo()).toBe(false);
    expect(after.redo()).toBe(false);
    expect(place(byId(doc).get(id)!)).toBe(`500,500,${STICKY_SIZE_WORLD},${STICKY_SIZE_WORLD}`);

    // The new controller is a controller, not a corpse: my next change is undoable.
    after.boundary();
    deleteObjects(doc, [id]);
    after.boundary();
    expect(after.canUndo()).toBe(true);
    expect(after.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);

    // A destroyed controller does not throw, does not come back, and does not
    // disturb the live one that replaced it.
    expect(() => first.destroy()).not.toThrow();
    expect(() => first.boundary()).not.toThrow();
    expect(first.canUndo()).toBe(false);
    expect(first.undo()).toBe(false);
    expect(after.canRedo()).toBe(true);
    expect(after.canUndo()).toBe(false);
    expect(place(byId(doc).get(id)!)).toBe(`500,500,${STICKY_SIZE_WORLD},${STICKY_SIZE_WORLD}`);

    // and the note I deleted is still mine to bring back.
    expect(after.redo()).toBe(true);
    expect(after.undo()).toBe(true);
    expect(after.canUndo()).toBe(false);
  });

  it('holds a step of a type it was not given at the start (addScope)', () => {
    const doc = newBoard();
    const undo = createUndo(doc);
    // What story 16 will do with the comments map: a type outside the objects map,
    // added to the same history, becomes undoable with no new undo code.
    const comments = doc.getMap<unknown>('comments');
    undo.addScope(comments);

    expect(undo.canUndo()).toBe(false);
    doc.transact(() => {
      comments.set('first', 'a comment on the board');
    }, LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(doc.getMap('comments').get('first')).toBeUndefined();
    expect(undo.redo()).toBe(true);
    expect(doc.getMap('comments').get('first')).toBe('a comment on the board');
  });

  it('is a controller whose notes are its own: an object of the default size', () => {
    // A cheap guard on the helper the whole file leans on: `place` compares the
    // size the model gave a fresh note, so a fixture that did not mean what it
    // says would make every position assertion above meaningless.
    const doc = newBoard();
    const id = add(doc, { x: 0, y: 0 });
    const note = byId(doc).get(id)!;
    expect(note.width).toBe(STICKY_SIZE_WORLD);
    expect(place(note)).toBe(`${-STICKY_SIZE_WORLD / 2},${-STICKY_SIZE_WORLD / 2},${STICKY_SIZE_WORLD},${STICKY_SIZE_WORLD}`);
  });
});
