// undo.history (unit): the per-person undo controller over real `Y.Doc`s, with a
// simulated remote peer and story 4 load so "only my own changes are undoable, and
// nobody else's are ever reversed" is proven against the real Yjs merge machinery.
// TC ids are the Acceptance Cases in
// spec/stories/008-undo-and-redo-my-own-changes-without-undoing-anyon/design.md.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  objectBounds,
  resizeObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { SHORT_PHRASE } from '../fixtures/texts';
import { createPeer } from './helpers/peer';

/** A fresh board document with a sticky-note object in it. */
function setup(): { doc: Y.Doc; undo: UndoController } {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = createUndo(doc);
  return { doc, undo };
}

/** The full state of a note, so "restored exactly" checks text, colour, size,
 * position and stacking, not just one field. */
function fullState(doc: Y.Doc, id: string): unknown {
  const note = snapshot(doc).find((n) => n.id === id);
  if (note === undefined) return null;
  return {
    x: note.x,
    y: note.y,
    z: note.z,
    color: note.color,
    text: note.text,
    ...(note.width === undefined ? {} : { width: note.width }),
    ...(note.height === undefined ? {} : { height: note.height }),
  };
}

/** Type into a note the way the editor does, so the keystroke is tracked (LOCAL_ORIGIN). */
function typeInto(doc: Y.Doc, id: string, str: string): void {
  const text = getStickyText(doc, id);
  if (text === undefined) return;
  doc.transact(() => text.insert(text.length, str), LOCAL_ORIGIN);
}

describe('undo.history', () => {
  // TC-01: local move undone, a peer's create and recolour left intact (negative:
  // other people's changes are never reversed).
  it('TC-01 undoes only my move and leaves a peer create and recolour alone', () => {
    const { doc, undo } = setup();
    const peer = createPeer(doc);

    const x = createSticky(doc, { x: 100, y: 100 }, 'yellow');
    const z = createSticky(doc, { x: 500, y: 100 }, 'yellow');
    undo.boundary();

    // my change: move X
    moveObject(doc, x, 300, 300);
    undo.boundary();

    // the peer's changes: create Y, recolour Z
    let y = '';
    peer.change((d) => {
      y = createSticky(d, { x: 900, y: 100 }, 'green');
    });
    peer.change((d) => {
      setStickyColor(d, z, 'pink');
    });

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    // X returned to where it was
    expect(snapshot(doc).find((n) => n.id === x)).toMatchObject({ x: 0, y: 0 });
    // Y still exists
    expect(snapshot(doc).some((n) => n.id === y)).toBe(true);
    // Z keeps the peer's colour, not one I could undo
    expect(snapshot(doc).find((n) => n.id === z)?.color).toBe('pink');
  });

  // TC-02: remote changes only -> nothing to undo.
  it('TC-02 keeps canUndo false when only a peer changed the board', () => {
    const { doc, undo } = setup();
    const peer = createPeer(doc);

    peer.change((d) => {
      createSticky(d, { x: 100, y: 100 });
    });

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  // TC-03: story 4 load updates -> nothing to undo.
  it('TC-03 keeps canUndo false for updates applied with the load origin', () => {
    const { doc, undo } = setup();
    const peer = createPeer(doc);

    peer.load((d) => {
      createSticky(d, { x: 100, y: 100 });
    });

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-04: delete a cluster of 8 notes, undo restores all 8 with text, colour,
  // size and position.
  it('TC-04 restores a whole deleted cluster with text, colour, size and position', () => {
    const { doc, undo } = setup();

    const ids: string[] = [];
    const before: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 220, y: 0 }, 'blue');
      typeInto(doc, id, `note ${i}`);
      const x = i * 300 + 5;
      moveObject(doc, id, x, 40);
      if (i % 2 === 0) resizeObjects(doc, new Map([[id, { x, y: 40, width: 300 + i, height: 180 + i }]]));
      undo.boundary();
      ids.push(id);
      before.push(fullState(doc, id));
    }

    // one delete of all 8
    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    for (let i = 0; i < 8; i++) {
      expect(fullState(doc, ids[i]!)).toEqual(before[i]);
    }
  });

  // TC-05: undo then redo re-applies the change.
  it('TC-05 re-applies an undone move on redo', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 100, y: 100 }); // top-left 0,0
    undo.boundary();

    moveObject(doc, id, 400, 250);
    undo.boundary();
    expect(snapshot(doc)[0]).toMatchObject({ x: 400, y: 250 });

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 0, y: 0 });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 400, y: 250 });
  });

  // TC-06: a new local change after an undo discards the redo history.
  it('TC-06 clears the redo history when a new change follows an undo', () => {
    const { doc, undo } = setup();
    const a = createSticky(doc, { x: 100, y: 100 });
    const b = createSticky(doc, { x: 500, y: 100 });
    undo.boundary();

    moveObject(doc, a, 400, 250);
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    // a new change clears redo
    moveObject(doc, b, 700, 700);
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  // TC-07 (error path): a peer deleted the object my step targets -> undo does not
  // throw, the object stays deleted, and the history keeps working (never dead-ends).
  it('TC-07 undoes past a move whose object a peer deleted, without error', () => {
    const { doc, undo } = setup();
    const peer = createPeer(doc);

    const b = createSticky(doc, { x: 500, y: 100 }); // top-left 400,0
    undo.boundary();
    moveObject(doc, b, 600, 200); // my older step
    undo.boundary();
    const a = createSticky(doc, { x: 800, y: 100 }); // top-left 700,0
    undo.boundary();
    moveObject(doc, a, 300, 300); // my newest step, on the object a peer will delete
    undo.boundary();

    peer.change((d) => {
      d.getMap<Y.Map<unknown>>('objects').delete(a);
    });

    // Undoing must not throw. A dead step (my move of the now-deleted A) is skipped,
    // the object stays deleted, and undo still reverses my earlier move of B.
    expect(() => undo.undo()).not.toThrow();
    expect(doc.getMap<Y.Map<unknown>>('objects').get(a)).toBeUndefined();
    expect(snapshot(doc).find((n) => n.id === b)).toMatchObject({ x: 400, y: 0 });

    // the rest of the history keeps working and drains without ever throwing
    let guard = 0;
    while (undo.canUndo() && guard++ < 50) {
      expect(() => undo.undo()).not.toThrow();
    }
    expect(undo.canUndo()).toBe(false);
  });

  // TC-08: a peer edited a note's text, then I deleted it; undo brings it back with
  // the content as it was at the moment of my delete.
  it('TC-08 restores my deleted note with the content it held at the time of the delete', () => {
    const { doc, undo } = setup();
    const peer = createPeer(doc);

    const a = createSticky(doc, { x: 100, y: 100 }, 'orange');
    undo.boundary();

    // the peer types into my note
    peer.change((d) => {
      getStickyText(d, a)?.insert(0, 'peer says hi');
    });
    expect(snapshot(doc).find((n) => n.id === a)?.text).toBe('peer says hi');

    // I delete the note (one step)
    deleteObjects(doc, [a]);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const restored = snapshot(doc).find((n) => n.id === a);
    expect(restored).toBeDefined();
    expect(restored?.text).toBe('peer says hi');
    expect(restored?.color).toBe('orange');
  });

  // TC-09 (boundary at UNDO_MAX_STEPS): adding a step past the limit keeps the
  // limit and drops the oldest.
  it('TC-09 drops the oldest step when a new one exceeds the maximum', () => {
    const { doc, undo } = setup();

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: (i % 10) * 220, y: Math.floor(i / 10) * 220 }));
      undo.boundary(); // each create is its own step
    }
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    // Undo until the history runs dry, counting the steps that actually changed the
    // board. The cap keeps exactly UNDO_MAX_STEPS, so the oldest create was dropped
    // and its note survives on the board.
    let applied = 0;
    while (undo.canUndo()) {
      if (undo.undo()) applied += 1;
    }
    expect(applied).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.id).toBe(ids[0]); // the survivor is the dropped first step
  });

  // TC-10 (boundary at UNDO_MAX_STEPS - 1): filling to the limit drops nothing.
  it('TC-10 drops nothing when a new step reaches exactly the maximum', () => {
    const { doc, undo } = setup();

    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: (i % 10) * 220, y: Math.floor(i / 10) * 220 });
      undo.boundary();
    }
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);

    let applied = 0;
    while (undo.canUndo()) {
      if (undo.undo()) applied += 1;
    }
    expect(applied).toBe(UNDO_MAX_STEPS);
    // nothing was dropped: the whole history undoes back to an empty board
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-11 (session only): destroying the controller and starting a fresh one (a
  // page reload) begins with nothing to undo.
  it('TC-11 starts empty after the controller is destroyed and replaced', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    moveObject(doc, id, 300, 300);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();

    // a fresh controller over the same document (what a reload builds): empty
    const reloaded = createUndo(doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
  });

  // boundary on an empty history is a no-op, and a note's measured size survives a
  // delete-restore (SHORT_PHRASE fixture keeps real prose in the mix).
  it('treats boundary on an empty history as a no-op', () => {
    const { doc, undo } = setup();
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, SHORT_PHRASE);
    expect(objectBounds(snapshot(doc)[0]!).width).toBeGreaterThan(0);
  });
});
