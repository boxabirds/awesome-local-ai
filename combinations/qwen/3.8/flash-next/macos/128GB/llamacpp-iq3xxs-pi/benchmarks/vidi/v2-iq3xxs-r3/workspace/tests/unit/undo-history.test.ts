/**
 * TC-01 to TC-11 (`undo.history`) — one person's work on one board, and nothing
 * else, in the two stacks.
 *
 * Every case here is a board with two people on it, one of them silent: the
 * tests are not about whether a change can be reversed — Yjs guarantees that —
 * but about which changes are *offered* for reversing. That is decided by the
 * transaction's origin, so each case says which door the change came in through
 * (this tab's toolbar, the room, or story 4's board load) and then checks what
 * Undo is willing to do about it. A step is bracketed by `boundary()` exactly as
 * the controls bracket it, so these are the stack contents the app really builds.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  objectSnapshots,
  resizeObjects,
  setStickyColor,
} from '../../src/shared/board-model';
import type { ObjectSnapshot, StickySnapshot } from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import { applyWithOrigin, link, peerDoc, sameBoard } from './helpers/peer';
import { LOAD_ORIGIN } from './helpers/peer';

/**
 * A note placed by a tab. `createSticky` can refuse a point that is not finite
 * (story 7's boundary), which would make every test here read `string | false`
 * and argue about a case no test is about; a helper turns the refusal into a
 * failing test instead.
 */
function stickyOn(doc: Y.Doc, at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  if (typeof id !== 'string') throw new Error(`createSticky refused ${JSON.stringify(at)}`);
  return id;
}

/** A board, somebody else on it, and this tab's history. */
function fixture(): { doc: Y.Doc; peer: Y.Doc; undo: UndoController } {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = peerDoc();
  link(doc, peer);
  return { doc, peer, undo: createUndo(doc) };
}

/** One action, bracketed by boundaries exactly as a control brackets it. */
function step<T>(undo: UndoController, action: () => T): T {
  undo.boundary();
  const done = action();
  undo.boundary();
  return done;
}

/**
 * This tab typing in a note, written the way the editor writes it: inside a
 * transaction carrying `LOCAL_ORIGIN`, which is the only thing that makes a
 * change one of mine. A bare `ytext.insert` would land on the board but belong
 * to nobody, and a test that passed on that would be testing nothing.
 */
function typeInto(doc: Y.Doc, id: string, at: number, text: string): void {
  doc.transact(() => getStickyText(doc, id)?.insert(at, text), LOCAL_ORIGIN);
}

/** The same typing, on the other person's document: never one of mine. */
function typeIntoPeer(peer: Y.Doc, id: string, at: number, text: string): void {
  peer.transact(() => getStickyText(peer, id)?.insert(at, text));
}

/** The board as it stands: every object, in the order it is drawn. */
const board = (doc: Y.Doc): readonly ObjectSnapshot[] => objectSnapshots(doc);
const noteAt = (doc: Y.Doc, id: string): ObjectSnapshot => {
  const found = board(doc).find((object) => object.id === id);
  if (!found) throw new Error(`no object ${id} on the board`);
  return found;
};
const textOf = (doc: Y.Doc, id: string): string => getStickyText(doc, id)?.toString() ?? '';
/** A note's visible fields, so a test can compare a whole note in one line. */
const face = (doc: Y.Doc, id: string) => {
  const object = noteAt(doc, id) as StickySnapshot;
  return {
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    color: object.color,
    text: object.text,
  };
};

describe('undo.history', () => {
  it('TC-01: undo takes back my change and leaves theirs standing', () => {
    const { doc, peer, undo } = fixture();
    const mine = step(undo, () => stickyOn(doc, { x: 100, y: 100 }));
    const theirs = stickyOn(peer, { x: 700, y: 500 });
    const placed = noteAt(doc, mine);

    step(undo, () => moveObject(doc, mine, placed.x + 120, placed.y + 80));
    expect(noteAt(doc, mine).x).toBe(placed.x + 120);

    // Somebody else recolours my note while I am deciding what to do.
    setStickyColor(peer, mine, 'pink');
    expect(board(doc)).toHaveLength(2);

    expect(undo.undo()).toBe(true);

    // My move is gone; their recolour and their note are where they were left.
    expect(noteAt(doc, mine)).toMatchObject({ x: placed.x, y: placed.y, color: 'pink' });
    expect(board(doc).some((object) => object.id === theirs)).toBe(true);
    // Their screen sees my taking-back, and the two boards still match.
    expect(noteAt(peer, mine).x).toBe(placed.x);
    expect(sameBoard(doc, peer)).toBe(true);
  });

  it('TC-02: a board whose only changes came from others has nothing to undo', () => {
    const { doc, peer, undo } = fixture();
    const theirs = stickyOn(peer, { x: 400, y: 400 });
    getStickyText(peer, theirs)?.insert(0, 'their note');
    moveObject(peer, theirs, 520, 460);
    setStickyColor(peer, theirs, 'cyan');

    expect(board(doc)).toHaveLength(1); // their work arrived, as it should
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false); // error path: asked to undo when there is nothing
    expect(board(doc)).toHaveLength(1); // and their work is still standing
    expect(textOf(doc, theirs)).toBe('their note');
  });

  it('TC-03: a board loaded from storage is not history either', () => {
    const saved = peerDoc();
    stickyOn(saved, { x: 100, y: 100 });
    stickyOn(saved, { x: 300, y: 300 });

    const doc = new Y.Doc();
    initDoc(doc);
    applyWithOrigin(doc, saved, LOAD_ORIGIN); // story 4's door: the board load
    const undo = createUndo(doc);

    expect(board(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(board(doc)).toHaveLength(2);
  });

  it('TC-04: one delete of a multi-object selection comes back as one step', () => {
    const { doc, undo } = fixture();
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const id = step(undo, () => stickyOn(doc, { x: 200 + index * 300, y: 200 }));
      step(undo, () => {
        typeInto(doc, id, 0, `note ${index}`);
        setStickyColor(doc, id, index % 2 === 0 ? 'cyan' : 'pink');
        resizeObjects(
          doc,
          new Map([[id, { x: 200 + index * 300, y: 200, width: 140 + index, height: 120 + index }]]),
        );
      });
      ids.push(id);
    }
    const beforeDelete = new Map(ids.map((id) => [id, face(doc, id)]));

    step(undo, () => deleteObjects(doc, ids));
    expect(board(doc)).toHaveLength(0);

    // One step back, and all eight are back: the delete was one step, not eight.
    expect(undo.undo()).toBe(true);
    expect(board(doc)).toHaveLength(8);
    for (const id of ids) expect(face(doc, id)).toEqual(beforeDelete.get(id));
  });

  it('TC-05: redo puts my position, text and colour back again', () => {
    const { doc, undo } = fixture();
    const id = step(undo, () => stickyOn(doc, { x: 0, y: 0 }));
    const created = face(doc, id);

    step(undo, () => moveObject(doc, id, 300, 400));
    step(undo, () => typeInto(doc, id, 0, 'restored'));
    step(undo, () => setStickyColor(doc, id, 'pink'));
    const done = face(doc, id);

    for (let index = 0; index < 3; index += 1) expect(undo.undo()).toBe(true);
    expect(face(doc, id)).toEqual(created);

    expect(undo.canRedo()).toBe(true);
    for (let index = 0; index < 3; index += 1) expect(undo.redo()).toBe(true);
    expect(face(doc, id)).toEqual(done);
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false); // error path: nothing left to redo
  });

  it('TC-06: a new change empties the redo stack', () => {
    const { doc, undo } = fixture();
    const id = step(undo, () => stickyOn(doc, { x: 0, y: 0 }));

    step(undo, () => setStickyColor(doc, id, 'pink'));
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    step(undo, () => moveObject(doc, id, 250, 250));
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-07: undoing my move of a note they deleted does not resurrect it', () => {
    const { doc, peer, undo } = fixture();
    const mine = step(undo, () => stickyOn(doc, { x: 300, y: 300 }));
    step(undo, () => moveObject(doc, mine, 640, 420));

    deleteObjects(peer, [mine]); // they delete it while I watch
    expect(board(doc).some((object) => object.id === mine)).toBe(false);
    expect(undo.canUndo()).toBe(true); // my move is still in my history

    // `undo.safe`: taking that step back must not bring the note back to life.
    expect(() => undo.undo()).not.toThrow();
    expect(board(doc).some((object) => object.id === mine)).toBe(false);
    // And the history is still a history: the next step is answered, not broken.
    expect(() => undo.undo()).not.toThrow();
    expect(sameBoard(doc, peer)).toBe(true);
  });

  it('TC-08: undoing my delete restores the text that was there, theirs included', () => {
    const { doc, peer, undo } = fixture();
    const id = step(undo, () => stickyOn(doc, { x: 200, y: 200 }));
    step(undo, () => typeInto(doc, id, 0, 'mine '));

    // They write in the same note (live.coexist), while I watch.
    typeIntoPeer(peer, id, textOf(doc, id).length, 'theirs');
    expect(textOf(doc, id)).toBe('mine theirs');

    step(undo, () => deleteObjects(doc, [id]));
    expect(board(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('mine theirs'); // `undo.shared_text`
    expect(noteAt(peer, id).x).toBeDefined(); // and back on their screen too
  });

  it(`TC-09: the stack holds ${UNDO_MAX_STEPS} steps, the oldest is dropped`, () => {
    const { doc, undo } = fixture();
    const ids: string[] = [];
    for (let index = 0; index < UNDO_MAX_STEPS + 1; index += 1) {
      ids.push(step(undo, () => stickyOn(doc, { x: index * 300, y: 0 })));
    }

    let undone = 0;
    while (undo.undo()) undone += 1;

    // One step more was taken than the stack kept, so one note survives: the
    // oldest, whose step was dropped to make room.
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(board(doc).map((object) => object.id)).toEqual([ids[0]]);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false); // error path: past the end of the stack
  });

  it(`TC-10: exactly ${UNDO_MAX_STEPS} steps undo to an empty board`, () => {
    const { doc, undo } = fixture();
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      step(undo, () => stickyOn(doc, { x: index * 300, y: 0 }));
    }

    let undone = 0;
    while (undo.undo()) undone += 1;

    // The boundary: no step was dropped, so every one of them comes back, and
    // the board is empty again — nothing is left over from the extra step in TC-09.
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(board(doc)).toHaveLength(0);
  });

  it('TC-11: leaving the board and coming back starts a new history', () => {
    const { doc, undo } = fixture();
    const id = step(undo, () => stickyOn(doc, { x: 0, y: 0 }));
    step(undo, () => moveObject(doc, id, 300, 300));
    expect(undo.canUndo()).toBe(true);

    undo.destroy(); // what leaving the board (or another board) does
    const fresh = createUndo(doc); // and what coming back creates

    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    expect(fresh.redo()).toBe(false);
    // `undo.session_only` is about memory, not about the board: the note is where it was.
    expect(noteAt(doc, id).x).toBe(300);
  });

  it('notices every stack change, and watches only the scope it was given', () => {
    const { doc, peer, undo } = fixture();
    let notices = 0;
    const stop = undo.onChange(() => {
      notices += 1;
    });

    // A map that is not in scope — the shape story 16's comments will have.
    const comments = doc.getMap<string>('comments');
    doc.transact(() => comments.set('first', 'unwatched'), LOCAL_ORIGIN);
    expect(comments.get('first')).toBe('unwatched');
    expect(undo.canUndo()).toBe(false);
    expect(notices).toBe(0);

    undo.addScope(comments);
    doc.transact(() => comments.set('second', 'watched now'), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(comments.get('second')).toBeUndefined();
    expect(comments.get('first')).toBe('unwatched'); // never was in scope
    expect(notices).toBeGreaterThan(0);

    // Somebody else's work: on my board, never in my history.
    stickyOn(peer, { x: 10, y: 10 });
    expect(undo.canUndo()).toBe(false);

    stop();
    const quiet = notices;
    step(undo, () => stickyOn(doc, { x: 90, y: 90 }));
    expect(notices).toBe(quiet); // unsubscribed, as promised
    undo.destroy();
  });
});
