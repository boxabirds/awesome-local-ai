// Story 8, task 6: unit tests (TC-01 to TC-11) for the per-client undo
// history (design: "UndoController", unit scope, anchors undo.own,
// undo.session_only, undo.redo_cleared, undo.safe, undo.limit).
//
// Test-first: these fail until createUndo (src/client/board/undo.ts) exists.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createStickyAt,
  deleteObject,
  deleteObjects,
  getStickyText,
  moveObject,
  resizeObjects,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { applyLoadUpdate, createPeer, getObject, rawSticky } from './peer';

describe('story 8: undo history (undo.own)', () => {
  it('TC-01: undo reverses my move, never a peer change', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);

    peer.apply(() => {
      rawSticky(peer.doc, 'X', 10, 20, 'yellow');
      rawSticky(peer.doc, 'Z', 30, 40, 'yellow');
    });

    // My move of X.
    moveObject(doc, 'X', 110, 220);

    // The peer creates Y and recolors Z while I am working.
    peer.apply(() => {
      rawSticky(peer.doc, 'Y', 900, 900, 'pink');
      getObject(peer.doc, 'Z')?.set('color', 'green');
    });

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    const byId = new Map(snapshot(doc).map((s) => [s.id, s]));
    expect(byId.get('X')).toMatchObject({ x: 10, y: 20, color: 'yellow' }); // my move reverted
    expect(byId.has('Y')).toBe(true); // peer create not undone
    expect(byId.get('Z')?.color).toBe('green'); // peer recolor not undone

    // Nothing of mine is left to undo.
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    undo.destroy();
    peer.close();
  });

  it('TC-02: peer-only changes are never undoable (empty stack)', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);

    peer.apply(() => {
      rawSticky(peer.doc, 'A', 0, 0, 'yellow');
      rawSticky(peer.doc, 'B', 10, 10, 'green');
    });

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2); // objects stay
    undo.destroy();
    peer.close();
  });

  it('TC-03: load updates (LOAD origin) are never undoable (undo.session_only)', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);

    // Simulate a remote board state arriving as a load (story 4 semantics:
    // applied with a non-local LOAD origin).
    peer.apply(() => {
      rawSticky(peer.doc, 'L', 5, 6, 'blue');
      rawSticky(peer.doc, 'M', 7, 8, 'violet');
    });
    const bytes = Y.encodeStateAsUpdate(peer.doc, Y.encodeStateVector(doc));
    applyLoadUpdate(doc, bytes);

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
    undo.destroy();
    peer.close();
  });

  it('TC-04: one delete of 8 notes is one step; undo restores everything', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      undo.boundary();
      ids.push(createStickyAt(doc, 100 * i, 50 * i, ['yellow', 'green', 'blue'][i % 3]));
    }
    // Some notes carry text; one has a custom size.
    const text = getStickyText(doc, ids[0])!;
    doc.transact(() => {
      text.insert(0, 'important note');
    }, LOCAL_ORIGIN);
    undo.boundary();
    resizeObjects(doc, new Map([[ids[1], { x: 100, y: 50, width: 300, height: 250 }]]));
    undo.boundary();

    const before = snapshot(doc);
    expect(before).toHaveLength(8);

    // One multi-delete (story 7's deleteObjects) = one transaction.
    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc)).toHaveLength(0);

    // One undo restores all eight with text, colour, size and position.
    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      const a = after.find((s) => s.id === b.id);
      expect(a).toEqual(b);
    }
    undo.destroy();
  });

  it('TC-05: redo re-applies the undone move', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);

    peer.apply(() => {
      rawSticky(peer.doc, 'X', 10, 20, 'yellow');
    });

    moveObject(doc, 'X', 110, 120);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 10, y: 20 });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 110, y: 120 });
    expect(undo.canRedo()).toBe(false);
    undo.destroy();
    peer.close();
  });

  it('TC-06: a new change after undo clears the redo history (undo.redo_cleared)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    undo.boundary();
    createStickyAt(doc, 0, 0);
    undo.boundary();
    createStickyAt(doc, 100, 0);
    undo.boundary();

    expect(undo.undo()).toBe(true); // removes the second note
    expect(undo.canRedo()).toBe(true);

    // A new local change invalidates the redo history.
    undo.boundary();
    createStickyAt(doc, 200, 0);
    expect(undo.canRedo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
    undo.destroy();
  });

  it('TC-07: undo of a move whose target was deleted remotely does not throw or resurrect (undo.safe)', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);

    peer.apply(() => {
      rawSticky(peer.doc, 'X', 0, 0, 'yellow');
      rawSticky(peer.doc, 'Y', 500, 500, 'blue');
    });

    // Two of my moves: Y (still alive), then X (deleted remotely next).
    moveObject(doc, 'Y', 501, 501);
    undo.boundary();
    moveObject(doc, 'X', 60, 60);

    peer.apply(() => {
      peer.doc.getMap('objects').delete('X');
    });

    expect(() => undo.undo()).not.toThrow();
    const byId = new Map(snapshot(doc).map((s) => [s.id, s]));
    expect(byId.has('X')).toBe(false); // not resurrected
    expect(byId.get('Y')).toMatchObject({ x: 500, y: 500 }); // earlier own step still works
    undo.destroy();
    peer.close();
  });

  it('TC-08: undo of my delete restores the note with its content at delete time', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);

    peer.apply(() => {
      rawSticky(peer.doc, 'X', 12, 34, 'violet');
    });

    // The peer types into X before I delete it.
    peer.apply(() => {
      const obj = getObject(peer.doc, 'X')!;
      (obj.get('text') as Y.Text).insert(0, 'peer content');
    });

    const before = snapshot(doc);
    expect(before[0]?.text).toBe('peer content');

    undo.boundary();
    expect(deleteObject(doc, 'X')).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before[0]); // position, colour, text at delete time
    undo.destroy();
    peer.close();
  });

  it('TC-09: at UNDO_MAX_STEPS a new step drops the oldest (undo.limit)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const ids: string[] = [];
    // UNDO_MAX_STEPS + 1 = 201 own steps: the first one must be dropped.
    for (let i = 0; i <= UNDO_MAX_STEPS; i++) {
      undo.boundary();
      ids.push(createStickyAt(doc, i, 0, 'yellow'));
    }

    // Exactly UNDO_MAX_STEPS undos remain possible.
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.canUndo()).toBe(false);

    // Only the note created by the dropped (oldest) step survives.
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(ids[0]);
    undo.destroy();
  });

  it('TC-10: at UNDO_MAX_STEPS - 1 one more step fits without dropping (undo.limit)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      undo.boundary();
      ids.push(createStickyAt(doc, i, 0, 'yellow'));
    }

    // All UNDO_MAX_STEPS steps are undoable: the board ends up empty.
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.canUndo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });

  it('TC-11: a fresh controller (reload) starts with empty history (undo.session_only)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    undo.boundary();
    createStickyAt(doc, 0, 0);
    expect(undo.canUndo()).toBe(true);
    undo.destroy();

    // A new controller on the same doc (simulating a reload / board switch)
    // has no memory of the destroyed one's steps.
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.redo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1); // the note itself remains
    fresh.destroy();
  });
});
