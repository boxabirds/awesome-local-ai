/**
 * Whose changes the history holds (TC-01 to TC-11).
 *
 * The claim under test is not that a change can be reversed — any undo does that — it is that the
 * history belongs to one person. So almost every test here has a colleague in it, and the interesting
 * assertion is never the one about the note that comes back: it is the one about the note that a naive
 * undo would have taken away with it. A colleague who added something while I was working still finds
 * it there after my undo, in the colour they gave it, in the place they moved it to.
 *
 * Every test builds its board *before* the controller exists, which is what a controller created when a
 * board opens actually is: a board that was already there is not something this person did, and the
 * room's own load origin proves the same point from the other side (TC-03).
 *
 * The colleague is a second real document exchanging updates with the first (see `helpers/peer`); what
 * makes it a colleague rather than a copy is the origin its changes arrive under, which is the whole of
 * what the controller filters on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, UNDO_MAX_STEPS } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';
import { applyLoadUpdate, boardWrittenElsewhere, createPeer } from './helpers/peer';
import type { Peer } from './helpers/peer';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const opened: Peer[] = [];

afterEach(() => {
  for (const peer of opened.splice(0)) peer.destroy();
});

interface Board {
  doc: Y.Doc;
  undo: UndoController;
  peer: Peer;
}

/**
 * A board as it is when a person arrives at it: built, loaded, and only then watched.
 *
 * `createUndo` runs after the notes are there for the same reason the app runs it when the board mounts —
 * nothing that was on the board before this person opened it is theirs to undo.
 */
function board(build: (doc: Y.Doc) => void = () => {}): Board {
  const doc = new Y.Doc();
  initDoc(doc);
  build(doc);
  const undo = createUndo(doc);
  const peer = createPeer(doc);
  opened.push(peer);
  return { doc, undo, peer };
}

/** One object by id, as the document reports it. */
function object(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return snapshot(doc).find((entry) => entry.id === id);
}

/** A note's fields worth naming in an assertion: where it is, how big, what colour, what it says. */
function fields(doc: Y.Doc, id: string): Record<string, unknown> | undefined {
  const entry = object(doc, id);
  if (entry === undefined) return undefined;
  return { x: entry.x, y: entry.y, width: entry.width, height: entry.height, color: entry.color, text: entry.text };
}

/** The whole board as id → fields, so a restored board can be compared with the board that was lost. */
function everything(doc: Y.Doc): Map<string, Record<string, unknown> | undefined> {
  return new Map(snapshot(doc).map((entry) => [entry.id, fields(doc, entry.id)]));
}

/** The ids on the board, so a test can point at "the note that was added" without a uuid. */
function ids(doc: Y.Doc): string[] {
  return snapshot(doc).map((entry) => entry.id);
}

/** One local mutation of a note's text: typing is a local transaction, whatever else is in one. */
function write<T>(doc: Y.Doc, edit: () => T): T {
  return Y.transact(doc, edit, LOCAL_ORIGIN);
}

/**
 * How many steps this person has, counted the only way the interface can count them: by undoing them
 * all and watching for the answer to stop being yes.
 */
function countUndoSteps(undo: UndoController, limit = UNDO_MAX_STEPS + 10): number {
  let steps = 0;
  while (undo.undo()) {
    steps += 1;
    if (steps > limit) throw new Error(`the history did not run out within ${limit} undos`);
  }
  return steps;
}

describe('undo only my own changes', () => {
  it('TC-01: undoing my move leaves my colleague’s later work exactly where it is', () => {
    const { doc, undo, peer } = board();

    // A note of mine, and another note of mine that my colleague is about to get to.
    const mine = createSticky(doc, { x: 100, y: 100 });
    const recoloured = createSticky(doc, { x: 600, y: 100 });
    undo.boundary();

    // Raj joins: he adds a note, and gives one of mine a colour of his own.
    peer.change((d) => {
      createSticky(d, { x: 1200, y: 100 });
    });
    const theirs = ids(doc).at(-1)!;
    const hisNote = fields(doc, theirs);
    peer.change((d) => {
      setStickyColor(d, recoloured, 'blue');
    });
    const hisColour = fields(doc, recoloured);

    // I move my note, and undo.
    const was = fields(doc, mine);
    undo.boundary();
    moveObject(doc, mine, 400, 700);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    // Mine is back where it was — and nothing of his moved with it.
    expect(fields(doc, mine)).toEqual(was);
    expect(fields(doc, theirs)).toEqual(hisNote);
    expect(fields(doc, recoloured)).toEqual(hisColour);
  });

  it('TC-02: a board I have only ever watched has nothing for me to undo', () => {
    const { doc, undo, peer } = board();
    peer.change((d) => {
      createSticky(d, { x: 300, y: 300 });
    });

    expect(snapshot(doc).length).toBe(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(snapshot(doc).length).toBe(1);
  });

  it('TC-03: the board arriving from storage is not something I did', () => {
    const { doc, undo } = board();
    const loaded = boardWrittenElsewhere((d) => {
      createSticky(d, { x: 200, y: 200 });
      createSticky(d, { x: 500, y: 500 });
    });

    applyLoadUpdate(doc, loaded);

    expect(snapshot(doc).length).toBe(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc).length).toBe(2);
  });

  it('TC-04: undoing one accidental Delete brings eight notes back with everything on them', () => {
    const cluster: string[] = [];
    const { doc, undo } = board((d) => {
      for (let index = 0; index < 8; index += 1) {
        const id = createSticky(d, { x: 100 + index * 300, y: 400 });
        cluster.push(id);
        write(d, () => getStickyText(d, id)!.insert(0, `note ${index}`));
        write(d, () => setStickyColor(d, id, COLORS[index % COLORS.length]));
        write(d, () =>
          resizeObjects(d, new Map([[id, { x: 100 + index * 300, y: 400, width: 120 + index, height: 90 + index }]])),
        );
      }
    });

    const was = everything(doc);

    // One keystroke, eight notes gone.
    undo.boundary();
    expect(deleteObjects(doc, cluster)).toBe(8);
    expect(snapshot(doc).length).toBe(0);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(everything(doc)).toEqual(was);
  });

  it('TC-05: redo puts back the move I just undid', () => {
    const { doc, undo } = board();
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const start = fields(doc, id)!;
    moveObject(doc, id, 800, 600);
    const moved = fields(doc, id)!;

    expect(undo.undo()).toBe(true);
    expect(fields(doc, id)).toEqual(start);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(fields(doc, id)).toEqual(moved);
    expect(undo.canUndo()).toBe(true);
  });

  it('TC-06: making a change after undoing throws away what I could have redone', () => {
    const { doc, undo } = board();
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 40, 40);
    undo.boundary();
    setStickyColor(doc, id, 'pink');

    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    // A new change, and the redo stack is gone: there is no longer a "before" to go forward to.
    undo.boundary();
    setStickyColor(doc, id, 'green');
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-07: undoing a move of a note somebody else deleted does nothing, and the rest still works', () => {
    let target = '';
    let other = '';
    const { doc, undo, peer } = board((d) => {
      target = createSticky(d, { x: 0, y: 0 });
      other = createSticky(d, { x: 900, y: 0 });
    });
    const gone = target;

    // Two of my own steps, the newer one about a note that is about to outlive it.
    undo.boundary();
    setStickyColor(doc, other, 'blue');
    undo.boundary();
    moveObject(doc, target, 400, 400);

    // My colleague deletes the note I was holding.
    peer.change((d) => deleteObjects(d, [gone]));
    expect(object(doc, gone)).toBeUndefined();

    // No error, and nothing of theirs comes back. A step whose note is gone has nothing left to write,
    // so it is passed over rather than performed — which is the difference between a no-op and a crash.
    expect(() => undo.undo()).not.toThrow();
    expect(object(doc, gone)).toBeUndefined();

    // And the history is not broken by the passing: the step underneath is mine, and it did its work.
    expect(fields(doc, other)!.color).toBe('yellow');
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-08: undoing my delete brings the note back as it stood when I deleted it', () => {
    let note = '';
    const { doc, undo, peer } = board((d) => {
      note = createSticky(d, { x: 0, y: 0 });
      write(d, () => getStickyText(d, note)!.insert(0, 'kept'));
    });

    // Somebody else adds to that note while I am looking at it.
    peer.change((d) => {
      getStickyText(d, note)!.insert(4, ' — revised by a colleague');
    });
    const atDelete = fields(doc, note)!;

    undo.boundary();
    deleteObjects(doc, [note]);
    expect(object(doc, note)).toBeUndefined();
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(fields(doc, note)).toEqual(atDelete);
  });

  it('TC-09: a history of 200 steps drops the oldest step, not the newest', () => {
    const { doc, undo } = board();
    const created: string[] = [];

    // One step more than the history keeps, each one a separate action.
    for (let index = 0; index <= UNDO_MAX_STEPS; index += 1) {
      created.push(createSticky(doc, { x: index * 300, y: 0 }));
      undo.boundary();
    }

    expect(countUndoSteps(undo)).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);

    // Everything is gone but the first note, whose step fell off the end of the history.
    expect(ids(doc)).toEqual([created[0]]);
  });

  it('TC-10: a history of exactly 200 steps has lost nothing', () => {
    const { doc, undo } = board();

    // Exactly the limit, which is the other side of the same boundary.
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      createSticky(doc, { x: index * 300, y: 0 });
      undo.boundary();
    }

    expect(countUndoSteps(undo)).toBe(UNDO_MAX_STEPS);
    expect(ids(doc)).toEqual([]);
    expect(undo.canRedo()).toBe(true);
  });

  it('TC-11: closing the page and coming back starts with nothing to undo', () => {
    const { doc, undo } = board();
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 500, 500);
    expect(undo.canUndo()).toBe(true);

    // The board document is the thing that survives a reload; the history is not part of it.
    undo.destroy();
    const reopened = createUndo(doc);
    expect(reopened.canUndo()).toBe(false);
    expect(reopened.undo()).toBe(false);
    expect(snapshot(doc).length).toBe(1);
    reopened.destroy();

    // And the controller that went away keeps nothing new either: what it had is all it will ever have.
    moveObject(doc, id, 0, 0);
    expect(undo.undo()).toBe(true);
    expect(undo.canUndo()).toBe(false);
  });

  it('undoes a group move as one step, which is what a drag of five notes is', () => {
    const { doc, undo } = board((d) => {
      for (let index = 0; index < 5; index += 1) createSticky(d, { x: index * 300, y: 0 });
    });
    const listed = ids(doc);
    const was = everything(doc);

    undo.boundary();
    moveObjects(doc, new Map(listed.map((id, index) => [id, { x: 1000 + index * 300, y: 500 }])));
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(undo.canUndo()).toBe(false);
    expect(everything(doc)).toEqual(was);
  });
});
