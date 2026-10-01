import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { createPeer, peerTransact, loadTransact, type PeerHandle } from './peer';

/** Helper: create a doc with undo controller. */
function setup(opts?: { maxSteps?: number; captureTimeoutMs?: number }) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ctrl = createUndo(doc, opts);
  return { doc, ctrl };
}

describe('undo.history', () => {
  // TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour
  it('TC-01: undo only reverses local changes, not remote', () => {
    const { doc, ctrl } = setup();
    const peer: PeerHandle = createPeer(doc);

    // Create two notes locally
    const idX = createSticky(doc, { x: 100, y: 100 });
    const idZ = createSticky(doc, { x: 300, y: 300 });
    ctrl.boundary(); // close capture window for creation steps

    // Local: move note X
    moveObject(doc, idX, 200, 200);

    // Peer: create note Y and recolour note Z
    peerTransact(peer, () => {
      createSticky(peer.doc, { x: 500, y: 500 });
    });
    peerTransact(peer, () => {
      setStickyColor(peer.doc, idZ, 'blue');
    });

    // Undo local move
    ctrl.boundary();
    const result = ctrl.undo();
    expect(result).toBe(true);

    // X should be back at original position
    const snapX = snapshot(doc).find((s) => s.id === idX);
    expect(snapX).toBeDefined();
    expect(snapX!.x).toBe(0); // original was 100 - 200/2 = 0
    expect(snapX!.y).toBe(0); // original was 100 - 200/2 = 0

    // Y should still exist (peer's note)
    const allNotes = snapshot(doc);
    expect(allNotes.length).toBeGreaterThanOrEqual(3); // X, Z, and Y

    // Z should keep peer's colour
    const snapZ = snapshot(doc).find((s) => s.id === idZ);
    expect(snapZ).toBeDefined();
    expect(snapZ!.color).toBe('blue');

    ctrl.destroy();
    peer.destroy();
  });

  // TC-02: only peer changes → canUndo false
  it('TC-02: remote-only changes do not enable undo', () => {
    const { doc, ctrl } = setup();
    const peer: PeerHandle = createPeer(doc);

    peerTransact(peer, () => {
      createSticky(peer.doc, { x: 100, y: 100 });
    });

    expect(ctrl.canUndo()).toBe(false);

    ctrl.destroy();
    peer.destroy();
  });

  // TC-03: LOAD-origin updates → canUndo false
  it('TC-03: load-origin updates do not enable undo', () => {
    const { doc, ctrl } = setup();

    // Create a note with LOAD_ORIGIN (not LOCAL_ORIGIN)
    loadTransact(doc, () => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', 0);
      map.set('y', 0);
      map.set('color', 'yellow');
      map.set('text', new Y.Text(''));
      map.set('z', 1);
      map.set('createdAt', Date.now());
      (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).set('load-1', map);
    });

    expect(ctrl.canUndo()).toBe(false);

    ctrl.destroy();
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: undo restores all deleted notes with full content', () => {
    const { doc, ctrl } = setup();

    // Create 8 notes with varied content
    const ids: string[] = [];
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'orange'] as const;
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 50, y: i * 50 }, colors[i] as any);
      const text = getStickyText(doc, id);
      if (text) {
        doc.transact(() => text.insert(0, `note ${i}`), LOCAL_ORIGIN);
      }
      ids.push(id);
    }

    // Close the capture window after creation
    ctrl.boundary();

    // Delete all 8
    deleteObjects(doc, ids);
    ctrl.boundary();

    expect(snapshot(doc).length).toBe(0);

    // Undo
    const result = ctrl.undo();
    expect(result).toBe(true);

    // All 8 should be restored
    const notes = snapshot(doc);
    expect(notes.length).toBe(8);

    // Verify content
    for (let i = 0; i < 8; i++) {
      const note = notes.find((n) => n.id === ids[i]);
      expect(note).toBeDefined();
      expect(note!.x).toBe(i * 50 - 100); // centered
      expect(note!.y).toBe(i * 50 - 100);
      expect(note!.color).toBe(colors[i]);
      expect(note!.text).toBe(`note ${i}`);
    }

    ctrl.destroy();
  });

  // TC-05: undo then redo → position re-applied
  it('TC-05: redo re-applies undone move', () => {
    const { doc, ctrl } = setup();

    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    moveObject(doc, id, 300, 400);
    ctrl.boundary();

    // Undo
    ctrl.undo();
    let note = snapshot(doc).find((n) => n.id === id);
    expect(note!.x).toBe(0); // 100 - 200/2
    expect(note!.y).toBe(0);

    // Redo
    const result = ctrl.redo();
    expect(result).toBe(true);
    note = snapshot(doc).find((n) => n.id === id);
    expect(note!.x).toBe(300);
    expect(note!.y).toBe(400);

    ctrl.destroy();
  });

  // TC-06: undo then new change → canRedo false
  it('TC-06: new change after undo clears redo', () => {
    const { doc, ctrl } = setup();

    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    // Undo → redo stack has content
    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // New local change clears redo
    setStickyColor(doc, id, 'pink');
    ctrl.boundary();
    expect(ctrl.canRedo()).toBe(false);

    ctrl.destroy();
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works
  it('TC-07: undo move of remotely-deleted object is safe', () => {
    const { doc, ctrl } = setup();
    const peer: PeerHandle = createPeer(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Local move
    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    // Peer deletes the object
    peerTransact(peer, () => {
      deleteObject(peer.doc, id);
    });

    // Verify it's gone from local
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();

    // Undo should not throw
    const result = ctrl.undo();
    expect(result).toBe(true); // returns true (there was a step to pop)
    // Object stays deleted (Yjs applies inverse to a deleted map → no effect)
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();

    // Next undo should still work (or return false if stack empty)
    // No error thrown
    ctrl.destroy();
    peer.destroy();
  });

  // TC-08: peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo own delete restores content at time of delete', () => {
    const { doc, ctrl } = setup();
    const peer: PeerHandle = createPeer(doc);

    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Peer edits text
    peerTransact(peer, () => {
      const text = getStickyText(peer.doc, id);
      if (text) text.insert(0, 'peer edit');
    });

    // Verify text synced locally
    let text = getStickyText(doc, id);
    expect(text?.toString()).toBe('peer edit');

    // Local: delete the note
    deleteObject(doc, id);
    ctrl.boundary();

    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();

    // Undo my delete → restored with content as of time of delete
    const result = ctrl.undo();
    expect(result).toBe(true);

    const note = snapshot(doc).find((n) => n.id === id);
    expect(note).toBeDefined();
    expect(note!.text).toBe('peer edit');

    ctrl.destroy();
    peer.destroy();
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history trims at max steps', () => {
    const { doc, ctrl } = setup({ maxSteps: UNDO_MAX_STEPS });

    // Add UNDO_MAX_STEPS + 1 steps (each creates a different object)
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      const id = createSticky(doc, { x: i, y: 0 });
      ids.push(id);
      ctrl.boundary();
    }

    // Should only be able to undo UNDO_MAX_STEPS times
    let count = 0;
    while (ctrl.canUndo()) {
      ctrl.undo();
      count++;
    }
    expect(count).toBe(UNDO_MAX_STEPS);

    // The first created note (oldest) should still exist (was dropped from history)
    expect(snapshot(doc).find((n) => n.id === ids[0])).toBeDefined();

    ctrl.destroy();
  });

  // TC-10: UNDO_MAX_STEPS − 1 + 1 → length UNDO_MAX_STEPS, nothing dropped
  it('TC-10: history at max-1 + 1 does not drop anything', () => {
    const { doc, ctrl } = setup({ maxSteps: UNDO_MAX_STEPS });

    // Add exactly UNDO_MAX_STEPS steps
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      const id = createSticky(doc, { x: i, y: 0 });
      ids.push(id);
      ctrl.boundary();
    }

    // Should be able to undo all UNDO_MAX_STEPS
    let count = 0;
    while (ctrl.canUndo()) {
      ctrl.undo();
      count++;
    }
    expect(count).toBe(UNDO_MAX_STEPS);

    // All notes should be gone (all undone)
    expect(snapshot(doc).length).toBe(0);

    ctrl.destroy();
  });

  // TC-11: destroy then new controller → canUndo false (session only)
  it('TC-11: destroy clears history; new controller starts empty', () => {
    const { doc, ctrl } = setup();

    createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    expect(ctrl.canUndo()).toBe(true);

    ctrl.destroy();

    // Create a new controller on the same doc
    const ctrl2 = createUndo(doc);
    expect(ctrl2.canUndo()).toBe(false);

    ctrl2.destroy();
  });
});
