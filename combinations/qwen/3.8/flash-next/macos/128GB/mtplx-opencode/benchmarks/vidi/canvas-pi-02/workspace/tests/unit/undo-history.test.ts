import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

const stickyOnly = (doc: Y.Doc) =>
  snapshot(doc).filter((s) => s.type === 'sticky') as StickySnapshot[];

/**
 * Story 8, undo.history (TC-01 to TC-11): the personal history over the
 * shared document.
 *
 * The rules under test are the ones the design calls unconditional: a step
 * only ever contains local transactions (`LOCAL_ORIGIN`), a change whose
 * targets were deleted remotely is a no-op rather than an error, and the
 * stack is capped at `undo.limit`. A "remote" change is simulated by
 * writing with a different origin - the same way the websocket provider
 * applies a peer's update - on the same document, because the undo history
 * is a property of one client's document, not of the room.
 */

/** Simulate one remote transaction: provider-style origin, so untracked. */
function remote(doc: Y.Doc, write: () => void): void {
  doc.transact(write, 'remote-peer');
}

/** A note that "came from the room": written before any history exists. */
function loadedNote(doc: Y.Doc, x: number, y: number, text = ''): string {
  const id = createSticky(doc, { x, y });
  if (text) getStickyText(doc, id)?.insert(0, text);
  return id;
}

function controller(doc: Y.Doc, options = {}): UndoController {
  return createUndo(doc, options);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('undo.history (TC-01 to TC-11)', () => {
  it('TC-01 a move by me is undone while a peer\'s create and recolour stay', () => {
    const doc = new Y.Doc();
    const x = loadedNote(doc, 100, 100);
    const z = loadedNote(doc, 400, 100);
    const undo = controller(doc);

    moveObject(doc, x, 160, 100);
    undo.boundary();
    remote(doc, () => {
      createSticky(doc, { x: 700, y: 100 });
      setStickyColor(doc, z, 'pink');
    });
    expect(undo.canUndo()).toBe(true);

    // My one step back: exactly the move. The remote origin is not tracked,
    // so undo cannot reach it even in principle.
    expect(undo.undo()).toBe(true);

    const notes = stickyOnly(doc);
    const moved = notes.find((note) => note.id === x);
    const recoloured = notes.find((note) => note.id === z);
    const created = notes.find((note) => note.text === '');
    // `loadedNote` centres at x, so the stored top-left was x - 100 = 0;
    // the move set the top-left to 160; the undo must bring it back to 0.
    expect(moved?.x).toBeCloseTo(0, 6);
    expect(recoloured?.color).toBe('pink'); // the peer's colour stays
    expect(created).toBeDefined(); // the peer's note stays
  });

  it('TC-02 remote changes alone leave my history empty', () => {
    const doc = new Y.Doc();
    const z = loadedNote(doc, 400, 100);
    const undo = controller(doc);

    remote(doc, () => {
      createSticky(doc, { x: 700, y: 100 });
      setStickyColor(doc, z, 'violet');
    });

    // Nobody's undo mistake, just nothing to undo: the stacks are the only
    // evidence the buttons have, and they are empty.
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-03 a document arriving from the room is a load, not my work', () => {
    const doc = new Y.Doc();
    const undo = controller(doc);

    // The way the sync layer delivers state: an update applied with no
    // tracked origin, after the history already listens.
    const source = new Y.Doc();
    createSticky(source, { x: 100, y: 100 });
    const first = Y.encodeStateAsUpdate(source);
    createSticky(source, { x: 300, y: 100 });
    const second = Y.encodeStateAsUpdate(source);
    Y.applyUpdate(doc, first); // origin: null, like a server-delivered sync
    Y.applyUpdate(doc, second, 'load'); // and with a load-style origin

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04 undoing a delete restores all eight notes whole', () => {
    const doc = new Y.Doc();
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      ids.push(loadedNote(doc, 60 + index * 220, 120, `note ${index}`));
    }
    setStickyColor(doc, ids[0]!, 'blue');
    const undo = controller(doc);

    const before = JSON.parse(JSON.stringify(snapshot(doc)));
    deleteObjects(doc, ids); // one Delete press: one step, eight notes
    expect(undo.stackSize().undo).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = JSON.parse(JSON.stringify(snapshot(doc)));
    // Text, colour and position, to the byte: a restored note is not a new
    // note wearing the old one's clothes.
    expect(after).toEqual(before);
  });

  it('TC-05 a move comes back on redo exactly as it left', () => {
    const doc = new Y.Doc();
    const x = loadedNote(doc, 100, 100);
    const undo = controller(doc);

    moveObject(doc, x, 250, 90);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    const movedBack = snapshot(doc).find((note) => note.id === x);
    expect(movedBack?.x).toBeCloseTo(0, 6);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    const movedAgain = snapshot(doc).find((note) => note.id === x);
    expect(movedAgain?.x).toBeCloseTo(250, 6);
    expect(movedAgain?.y).toBeCloseTo(90, 6);
  });

  it('TC-06 a new change clears the redo stack', () => {
    const doc = new Y.Doc();
    const x = loadedNote(doc, 100, 100);
    const undo = controller(doc);

    moveObject(doc, x, 250, 100);
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    setStickyColor(doc, x, 'pink'); // any new step
    expect(undo.canRedo()).toBe(false); // the future I did not take is gone
    expect(undo.redo()).toBe(false);
  });

  it('TC-07 undoing a move whose note was deleted remotely is a no-op, not an error', () => {
    const doc = new Y.Doc();
    const a = loadedNote(doc, 100, 100);
    const b = loadedNote(doc, 400, 100);
    const undo = controller(doc);

    setStickyColor(doc, b, 'pink'); // step 1
    undo.boundary();
    createSticky(doc, { x: 700, y: 100 }); // step 2
    undo.boundary();
    moveObject(doc, a, 220, 100); // step 3, the newest
    undo.boundary();
    remote(doc, () => deleteObject(doc, a)); // the peer deletes my note
    expect(snapshot(doc)).toHaveLength(2);

    // The top step points at a deleted object. Yjs drains dead stack items
    // until something actually applies: the press neither throws nor
    // resurrects the deleted note, and the history keeps working below the
    // drained item - which is what "an undo whose targets are gone is a
    // no-op, not an error" has to mean for the buttons to stay honest.
    expect(() => {
      expect(undo.undo()).toBe(true);
    }).not.toThrow();
    expect(snapshot(doc).find((note) => note.id === a)).toBeUndefined();
    expect(snapshot(doc)).toHaveLength(1); // the created note went back
    expect(undo.canUndo()).toBe(true); // and the history still works
    expect(undo.undo()).toBe(true); // the drain continued into step 1...
    expect(stickyOnly(doc)[0]!.color).toBe('yellow'); // ...and that colour landed
    expect(undo.undo()).toBe(false); // now empty, and honest about it
  });

  it('TC-08 undoing my delete restores a note a peer had edited', () => {
    const doc = new Y.Doc();
    const x = loadedNote(doc, 100, 100, 'start');
    const undo = controller(doc);

    remote(doc, () => getStickyText(doc, x)?.insert(6, ' + peer'));
    undo.boundary();
    deleteObject(doc, x); // my step, on top of the peer's edit

    expect(undo.undo()).toBe(true);
    const restored = snapshot(doc).find((note) => note.id === x);
    // The content as it stood at the time of the delete: the peer's text is
    // part of what comes back, and it stays intact on the wire too.
    expect((restored as any)?.text).toBe('start + peer');
    expect(getStickyText(doc, x)?.toString()).toBe('start + peer');
  });

  it('TC-09 a new step drops the oldest once the stack is full', () => {
    const doc = new Y.Doc();
    const undo = controller(doc); // the default `undo.limit`: 200

    const ids: string[] = [];
    for (let index = 0; index < 201; index += 1) {
      undo.boundary();
      ids.push(createSticky(doc, { x: index * 300, y: 0 }));
    }

    // 201 separate steps came in; the history keeps exactly `undo.limit`.
    expect(undo.stackSize().undo).toBe(200);

    // Draining it undoes 200 of the 201 creates - the dropped first one is
    // beyond reach now, which is what "the history rolls over" means.
    let applied = 0;
    while (undo.canUndo() && applied < 300) {
      undo.undo();
      applied += 1;
    }
    expect(applied).toBe(200);
    const left = snapshot(doc);
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(ids[0]);
  });

  it('TC-10 the 200th step fits without dropping anything', () => {
    const doc = new Y.Doc();
    const undo = controller(doc);

    for (let index = 0; index < 200; index += 1) {
      undo.boundary();
      createSticky(doc, { x: index * 300, y: 0 });
    }
    expect(undo.stackSize().undo).toBe(200);

    // Nothing at the cap has been squeezed out: every step is still there.
    let applied = 0;
    while (undo.canUndo()) {
      undo.undo();
      applied += 1;
    }
    expect(applied).toBe(200);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a new session starts with an empty history', () => {
    const doc = new Y.Doc();
    const first = controller(doc);
    const x = loadedNote(doc, 100, 100);
    moveObject(doc, x, 250, 100);
    expect(first.canUndo()).toBe(true);

    // The reload shape: the document is the same, the history is not.
    first.destroy();
    const second = controller(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.canRedo()).toBe(false);

    // And the fresh history still works on the same document.
    second.boundary();
    moveObject(doc, x, 10, 10);
    expect(second.canUndo()).toBe(true);
    expect(second.undo()).toBe(true);
    expect(snapshot(doc).find((note) => note.id === x)?.x).toBeCloseTo(250, 6);
  });
});
