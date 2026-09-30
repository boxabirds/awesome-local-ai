/**
 * Unit tests TC-01 to TC-11: undo.history
 *
 * Tests the UndoController contract over real Y.Docs with a simulated remote peer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  moveObject,
  setStickyColor,
  initDoc,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createSimulatedPeer, applyLoadUpdate, type SimulatedPeer } from './undo-peer';

const HALF = STICKY_SIZE_WORLD / 2;

describe('undo.history', () => {
  let doc: Y.Doc;
  let peer: SimulatedPeer;
  let ctrl: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    peer = createSimulatedPeer(doc);
  });

  afterEach(() => {
    ctrl.destroy();
    peer.destroy();
    doc.destroy();
  });

  // TC-01: local move; peer creates and recolours; undo → own move reverted, peer's changes intact
  it('TC-01: undo only reverses local changes, not remote ones', () => {
    // Create a note locally
    const id1 = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Move the note locally
    moveObject(doc, id1, 200, 200);
    ctrl.boundary();

    // Sync so peer has note1
    peer.syncToLocalToPeer();

    // Peer creates a note
    const id2 = createSticky(peer.doc, { x: 300, y: 300 });
    peer.syncPeerToLocal();

    // Peer recolours note 1
    const peerEntry1 = peer.doc.getMap('objects').get(id1) as Y.Map<unknown>;
    peer.doc.transact(() => {
      peerEntry1.set('color', 'blue');
    }, null);
    peer.syncPeerToLocal();

    // The local objects should reflect the remote colour change
    const objects = doc.getMap('objects');
    const entry1 = objects.get(id1) as Y.Map<unknown>;
    expect(entry1.get('color')).toBe('blue');

    // Now undo the local move (most recent local step)
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    // The local move was reversed (x went back to the original creation position)
    expect(entry1.get('x')).toBe(100 - HALF);
    expect(entry1.get('y')).toBe(100 - HALF);

    // The peer-created note still exists
    expect(objects.get(id2)).toBeDefined();

    // The peer's colour change is still there (not undone)
    expect(entry1.get('color')).toBe('blue');
  });

  // TC-02: only remote changes → canUndo false
  it('TC-02: remote changes only → canUndo is false', () => {
    // Peer creates a note (arrives as REMOTE_ORIGIN to local)
    createSticky(peer.doc, { x: 100, y: 100 });
    peer.syncPeerToLocal();

    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.undo()).toBe(false);
  });

  // TC-03: LOAD origin updates → canUndo false
  it('TC-03: LOAD-origin updates → canUndo is false', () => {
    // Create a doc with some content and apply it as a load update
    const sourceDoc = new Y.Doc();
    initDoc(sourceDoc);
    createSticky(sourceDoc, { x: 50, y: 50 });
    const update = Y.encodeStateAsUpdate(sourceDoc);

    applyLoadUpdate(doc, update);
    sourceDoc.destroy();

    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.undo()).toBe(false);
  });

  // TC-04: delete 8 notes, undo → all restored with text, colour, size, position
  it('TC-04: delete 8 notes then undo restores all with original data', () => {
    const objects = doc.getMap('objects');
    const ids: string[] = [];
    const expectedData: Array<{ x: number; y: number; color: string; text: string }> = [];

    // Create 8 notes with varied data
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 220, y: i * 220 }, 'orange');
      ids.push(id);
      const entry = objects.get(id) as Y.Map<unknown>;
      const text = entry.get('text') as Y.Text;
      doc.transact(() => { text.insert(0, `note ${i}`); }, LOCAL_ORIGIN);
      expectedData.push({ x: i * 220 - HALF, y: i * 220 - HALF, color: 'orange', text: `note ${i}` });
    }

    // Reset undo controller so undo stack only has the delete
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Delete all 8
    ctrl.boundary();
    deleteObjects(doc, ids);
    ctrl.boundary();

    expect(objects.size).toBe(0);

    // Undo the delete
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    // All 8 notes restored
    expect(objects.size).toBe(8);
    for (let i = 0; i < 8; i++) {
      const entry = objects.get(ids[i]) as Y.Map<unknown>;
      expect(entry).toBeDefined();
      expect(entry.get('x')).toBe(expectedData[i].x);
      expect(entry.get('y')).toBe(expectedData[i].y);
      expect(entry.get('color')).toBe(expectedData[i].color);
      const text = entry.get('text') as Y.Text;
      expect(text.toString()).toBe(expectedData[i].text);
    }
  });

  // TC-05: undo then redo → re-applied
  it('TC-05: undo then redo re-applies the change', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const objects = doc.getMap('objects');
    const entry = objects.get(id) as Y.Map<unknown>;
    const origX = entry.get('x') as number;
    const origY = entry.get('y') as number;

    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Move locally
    ctrl.boundary();
    moveObject(doc, id, 200, 300);
    ctrl.boundary();

    expect(entry.get('x')).toBe(200);
    expect(entry.get('y')).toBe(300);

    // Undo
    ctrl.undo();
    expect(entry.get('x')).toBe(origX);
    expect(entry.get('y')).toBe(origY);

    // Redo
    expect(ctrl.canRedo()).toBe(true);
    ctrl.redo();
    expect(entry.get('x')).toBe(200);
    expect(entry.get('y')).toBe(300);
  });

  // TC-06: undo then new change → canRedo false
  it('TC-06: new change after undo clears redo', () => {
    const id = createSticky(doc, { x: 100, y: 100 });

    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Move
    ctrl.boundary();
    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    // Undo
    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // New local change
    ctrl.boundary();
    setStickyColor(doc, id, 'green');
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, object stays deleted, next undo works
  it('TC-07: undo a move of a remotely deleted object → no throw, stays deleted', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Move it
    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    // Sync to peer, then peer deletes it
    peer.syncToLocalToPeer();
    peer.doc.transact(() => {
      peer.doc.getMap('objects').delete(id);
    }, null);
    peer.syncPeerToLocal();

    const objects = doc.getMap('objects');
    expect(objects.has(id)).toBe(false);

    // Undo the move → should not throw, object stays deleted
    expect(() => ctrl.undo()).not.toThrow();
    expect(objects.has(id)).toBe(false);

    // Next undo should still work (returns false or does nothing gracefully)
    expect(() => ctrl.undo()).not.toThrow();
  });

  // TC-08: peer edits note text, then local delete, undo → restored with content at time of delete
  it('TC-08: undo own delete restores content at time of delete', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    // Sync to peer
    peer.syncToLocalToPeer();

    // Peer edits text in the note
    const peerEntry = peer.doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(peerEntry).toBeDefined();
    const peerText = peerEntry.get('text') as Y.Text;
    peer.doc.transact(() => {
      peerText.insert(0, 'peer added text');
    }, null);
    peer.syncPeerToLocal();

    // Verify local has the peer's text
    const localEntry = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const localText = localEntry.get('text') as Y.Text;
    expect(localText.toString()).toBe('peer added text');

    // Now delete locally
    ctrl.boundary();
    deleteObjects(doc, [id]);
    ctrl.boundary();

    expect(doc.getMap('objects').has(id)).toBe(false);

    // Undo → note restored with content at time of delete (including peer's text)
    ctrl.undo();
    const restored = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(restored).toBeDefined();
    const restoredText = restored.get('text') as Y.Text;
    expect(restoredText.toString()).toBe('peer added text');
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length stays UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history trims to UNDO_MAX_STEPS', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Create exactly UNDO_MAX_STEPS steps (moves)
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      ctrl.boundary();
      moveObject(doc, id, i + 1, 0);
      ctrl.boundary();
    }

    // Add one more
    ctrl.boundary();
    moveObject(doc, id, UNDO_MAX_STEPS + 1, 0);
    ctrl.boundary();

    // Undo all the way should only be possible UNDO_MAX_STEPS times
    let undoCount = 0;
    while (ctrl.canUndo()) {
      ctrl.undo();
      undoCount++;
      if (undoCount > UNDO_MAX_STEPS + 10) break; // safety
    }
    expect(undoCount).toBe(UNDO_MAX_STEPS);
  });

  // TC-10: UNDO_MAX_STEPS − 1 + 1 → length UNDO_MAX_STEPS, nothing dropped
  it('TC-10: adding step at UNDO_MAX_STEPS − 1 keeps all', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Create exactly UNDO_MAX_STEPS - 1 steps
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      ctrl.boundary();
      moveObject(doc, id, i + 1, 0);
      ctrl.boundary();
    }

    // Add one more (total = UNDO_MAX_STEPS)
    ctrl.boundary();
    moveObject(doc, id, UNDO_MAX_STEPS, 0);
    ctrl.boundary();

    // Should be able to undo exactly UNDO_MAX_STEPS times
    let undoCount = 0;
    while (ctrl.canUndo()) {
      ctrl.undo();
      undoCount++;
      if (undoCount > UNDO_MAX_STEPS + 10) break;
    }
    expect(undoCount).toBe(UNDO_MAX_STEPS);
  });

  // TC-11: destroy controller then new controller → canUndo false (session only)
  it('TC-11: destroy controller → new controller starts empty', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();
    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    expect(ctrl.canUndo()).toBe(true);

    // Simulate page reload: destroy and create fresh
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    expect(ctrl.canUndo()).toBe(false);
  });
});
