import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  deleteObjects,
  resizeObjects,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { createPeerPair, applyLoadUpdate, PEER_ORIGIN } from './peer';

const controllers: UndoController[] = [];

function track(undo: UndoController): UndoController {
  controllers.push(undo);
  return undo;
}

afterEach(() => {
  while (controllers.length > 0) controllers.pop()!.destroy();
});

function find(snap: readonly StickySnapshot[], id: string): StickySnapshot {
  const found = snap.find((n) => n.id === id);
  if (!found) throw new Error(`object ${id} not found in snapshot`);
  return found;
}

describe('undo.history: per-user undo over the objects map', () => {
  // TC-01: local move X; peer creates Y and recolours Z;
  // undo → X restored, Y present, Z keeps peer colour (remote not undone)
  it('TC-01: undo reverses only my change, peer changes stay', () => {
    const { local, peer } = createPeerPair();
    initDoc(local);
    const idX = createSticky(local, { x: 100, y: 100 });
    const idZ = createSticky(local, { x: 300, y: 100 }, 'blue');
    const undo = track(createUndo(local));

    const start = find(snapshot(local), idX);

    // My change: move X
    moveObject(local, idX, start.x + 50, start.y + 50);

    // Peer's changes: create Y, recolour Z
    const idY = createSticky(peer, { x: 500, y: 500 });
    setStickyColor(peer, idZ, 'pink');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    const after = snapshot(local);
    expect(find(after, idX).x).toBe(start.x);
    expect(find(after, idX).y).toBe(start.y);
    // Peer's note still exists
    expect(after.some((n) => n.id === idY)).toBe(true);
    // Peer's colour change stays
    expect(find(after, idZ).color).toBe('pink');
    // Nothing left to undo
    expect(undo.canUndo()).toBe(false);
  });

  // TC-02: peer changes only → canUndo false
  it('TC-02: remote-only changes are not captured', () => {
    const { local, peer } = createPeerPair();
    initDoc(local);
    const undo = track(createUndo(local));

    createSticky(peer, { x: 0, y: 0 });
    setStickyColor(peer, 'does-not-matter', 'pink'); // no-op locally, still a peer transaction

    expect(undo.canUndo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  // TC-03: updates applied with the story 4 LOAD origin → canUndo false
  it('TC-03: load-origin updates are not captured', () => {
    const local = new Y.Doc();
    initDoc(local);
    const undo = track(createUndo(local));

    // Simulate the server sending the board state
    const server = new Y.Doc();
    createSticky(server, { x: 0, y: 0 });
    createSticky(server, { x: 250, y: 0 });
    applyLoadUpdate(local, Y.encodeStateAsUpdate(server));

    expect(snapshot(local)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-04: delete 8 notes, undo → all 8 restored with text, colour, size, position
  it('TC-04: one delete of 8 notes is one step and restores everything', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: 100 + (i % 4) * 260, y: 100 + Math.floor(i / 4) * 260 }, colors[i % colors.length]);
      getStickyText(doc, id)!.insert(0, `note ${i}`);
      ids.push(id);
    }
    // Give a couple of notes explicit sizes
    resizeObjects(doc, new Map([
      [ids[0], { x: 0, y: 0, width: 300, height: 150 }],
      [ids[1], { x: 260, y: 0, width: 120, height: 400 }],
    ]));
    // Move a few (all setup, merged or not, does not matter: boundary below)
    moveObject(doc, ids[2], 1000, 1000);

    const before = snapshot(doc);
    undo.boundary();

    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      const a = find(after, b.id);
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.width).toBe(b.width);
      expect(a.height).toBe(b.height);
      expect(a.color).toBe(b.color);
      expect(a.text).toBe(b.text);
      expect(a.z).toBe(b.z);
    }
    // The delete was exactly one step: the next undo reverses the whole
    // setup (all 8 creations), not part of the delete
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-05: undo then redo → re-applied
  it('TC-05: redo re-applies the undone change', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const undo = track(createUndo(doc));
    const start = find(snapshot(doc), id);

    undo.boundary();
    moveObject(doc, id, start.x + 80, start.y - 40);

    expect(undo.undo()).toBe(true);
    expect(find(snapshot(doc), id).x).toBe(start.x);
    expect(find(snapshot(doc), id).y).toBe(start.y);

    expect(undo.redo()).toBe(true);
    expect(find(snapshot(doc), id).x).toBe(start.x + 80);
    expect(find(snapshot(doc), id).y).toBe(start.y - 40);
    expect(undo.canRedo()).toBe(false);
  });

  // TC-06: undo, then new change → canRedo false
  it('TC-06: a new change after undo clears redo', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const undo = track(createUndo(doc));

    undo.boundary();
    setStickyColor(doc, id, 'blue');
    expect(undo.undo()).toBe(true);
    expect(find(snapshot(doc), id).color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    // New local change
    undo.boundary();
    moveObject(doc, id, 500, 500);
    expect(undo.canRedo()).toBe(false);
  });

  // TC-07: local move, peer deletes target, undo → no throw, still deleted,
  // next undo works
  it('TC-07: undoing a move of a remotely deleted object is a no-op', () => {
    const { local, peer } = createPeerPair();
    initDoc(local);
    const undo = track(createUndo(local));
    const idA = createSticky(local, { x: 0, y: 0 });
    const idB = createSticky(local, { x: 300, y: 0 });

    undo.boundary();
    moveObject(local, idA, 50, 50);

    // Peer deletes A (arrives on the local doc with the provider origin)
    peer.transact(() => {
      peer.getMap('objects').delete(idA);
    }, PEER_ORIGIN);

    // Undoing the move of a deleted object: no throw, no recreation
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(local).some((n) => n.id === idA)).toBe(false);

    // Next undo works: it undoes the step that created A and B
    expect(undo.undo()).toBe(true);
    expect(snapshot(local).some((n) => n.id === idB)).toBe(false);
    expect(snapshot(local).some((n) => n.id === idA)).toBe(false);
  });

  // TC-08: peer edits note text, then local delete, undo →
  // restored with content at time of delete
  it('TC-08: undoing my delete restores content as of my delete', () => {
    const { local, peer } = createPeerPair();
    initDoc(local);
    const id = createSticky(local, { x: 0, y: 0 });
    const undo = track(createUndo(local));

    // Peer edits the text before my delete
    const peerObj = peer.getMap('objects').get(id) as Y.Map<unknown>;
    const peerText = peerObj.get('text') as Y.Text;
    peerText.insert(0, 'peer content');

    undo.boundary();
    deleteObjects(local, [id]);
    expect(snapshot(local)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = find(snapshot(local), id);
    expect(after.text).toBe('peer content');
  });

  // TC-09: UNDO_MAX_STEPS steps + 1 → length stays UNDO_MAX_STEPS, oldest dropped
  it('TC-09: history is trimmed to UNDO_MAX_STEPS, oldest dropped', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const undo = track(createUndo(doc));

    undo.boundary();
    for (let i = 1; i <= UNDO_MAX_STEPS + 1; i++) {
      moveObject(doc, id, i, 0);
      undo.boundary();
    }

    // Exactly UNDO_MAX_STEPS undos succeed; the oldest step was dropped
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.undo()).toBe(false);
    // 201 moves applied, 200 undone → the oldest move (x = 1) survives
    expect(find(snapshot(doc), id).x).toBe(1);
  });

  // TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped
  it('TC-10: at UNDO_MAX_STEPS steps nothing is dropped', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const undo = track(createUndo(doc));

    const startX = find(snapshot(doc), id).x;
    undo.boundary();
    for (let i = 1; i <= UNDO_MAX_STEPS; i++) {
      moveObject(doc, id, i, 0);
      undo.boundary();
    }

    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.undo()).toBe(false);
    // All 200 moves undone → back to the original position
    expect(find(snapshot(doc), id).x).toBe(startX);
  });

  // TC-11: destroy then new controller → canUndo false (session only)
  it('TC-11: a fresh controller after destroy starts empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const undo = track(createUndo(doc));

    undo.boundary();
    moveObject(doc, id, 10, 10);
    expect(undo.canUndo()).toBe(true);
    undo.destroy();

    const fresh = track(createUndo(doc));
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
  });
});
