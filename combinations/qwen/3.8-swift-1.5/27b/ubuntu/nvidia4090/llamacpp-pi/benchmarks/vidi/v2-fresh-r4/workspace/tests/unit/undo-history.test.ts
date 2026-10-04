import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  deleteObjects,
  resizeObjects,
  snapshot,
  getStickyText,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { makePeer, applyLoadUpdate } from './peer';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

let controllers: UndoController[] = [];

function track(undo: UndoController): UndoController {
  controllers.push(undo);
  return undo;
}

afterEach(() => {
  for (const undo of controllers) undo.destroy();
  controllers = [];
});

function byId(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return snapshot(doc).find((s) => s.id === id);
}

describe('undo.history: per-user undo over a real Y.Doc with a simulated remote peer', () => {
  // TC-01: local move undone; peer create + recolour stay intact (undo.own)
  it('TC-01: undo restores my move; peer-created note exists and peer recolour kept', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = makePeer(doc);
    const undo = track(createUndo(doc));

    const idX = createSticky(doc, { x: 0, y: 0 });
    const idZ = createSticky(doc, { x: 400, y: 0 });
    undo.boundary();

    // My move of X
    moveObject(doc, idX, 100, 50);
    undo.boundary();

    // Peer creates Y and recolours Z
    createSticky(peer, { x: 800, y: 0 });
    const zOnPeer = peer.getMap('objects').get(idZ) as Y.Map<unknown>;
    peer.transact(() => {
      zOnPeer.set('color', 'blue');
    }, 'peer');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    // X restored to its old position (createSticky is center-anchored: (0,0) → (-100,-100))
    expect(byId(doc, idX)!.x).toBe(-100);
    expect(byId(doc, idX)!.y).toBe(-100);
    // Peer's new note Y exists
    expect(snapshot(doc).length).toBe(3);
    // Z keeps the peer's colour (not reverted to yellow)
    expect(byId(doc, idZ)!.color).toBe('blue');
    // The next undo is the note-creation step — the peer changes were
    // never captured, so undoing it only removes my own notes
    expect(undo.undo()).toBe(true);
    expect(byId(doc, idX)).toBeUndefined();
    expect(byId(doc, idZ)).toBeUndefined();
    expect(snapshot(doc).length).toBe(1); // only the peer's note remains
  });

  // TC-02: only peer changes → canUndo false (negative)
  it('TC-02: peer-only changes are not captured', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = makePeer(doc);
    const undo = track(createUndo(doc));

    createSticky(peer, { x: 0, y: 0 });
    const id = snapshot(peer)[0].id;
    setStickyColor(peer, id, 'blue');

    expect(snapshot(doc).length).toBe(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  // TC-03: LOAD-origin updates are not captured (story 4 load)
  it('TC-03: updates applied with the LOAD origin are not captured', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const source = new Y.Doc();
    initDoc(source);
    createSticky(source, { x: 0, y: 0 });
    createSticky(source, { x: 300, y: 0 });
    applyLoadUpdate(doc, Y.encodeStateAsUpdate(source));

    expect(snapshot(doc).length).toBe(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  // TC-04: delete 8 notes → undo restores all with text, colour, size, position
  it('TC-04: undo of a delete restores 8 notes with text, colour, size and position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 300, y: 40 * i });
      setStickyColor(doc, id, COLORS[i % COLORS.length]);
      const text = getStickyText(doc, id)!;
      doc.transact(() => {
        text.insert(0, `note ${i}`);
      }, LOCAL_ORIGIN);
      if (i % 2 === 0) {
        resizeObjects(doc, new Map([[id, { x: i * 300, y: 40 * i, width: 150, height: 250 }]]));
      }
      ids.push(id);
    }
    undo.boundary();

    const before = snapshot(doc);
    expect(before).toHaveLength(8);

    deleteObjects(doc, ids);
    undo.boundary();

    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      const a = byId(doc, b.id)!;
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.width ?? 200).toBe(b.width ?? 200);
      expect(a.height ?? 200).toBe(b.height ?? 200);
      expect(a.color).toBe(b.color);
      expect(a.text).toBe(b.text);
    }
  });

  // TC-05: undo then redo re-applies the move (undo.redo)
  it('TC-05: undo then redo re-applies the move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 10, 20);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    // Center-anchored creation: (0,0) → (-100,-100)
    expect(byId(doc, id)!.x).toBe(-100);
    expect(byId(doc, id)!.y).toBe(-100);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(byId(doc, id)!.x).toBe(10);
    expect(byId(doc, id)!.y).toBe(20);
    expect(undo.canRedo()).toBe(false);
  });

  // TC-06: new change after undo clears redo (undo.redo_cleared)
  it('TC-06: a new change after undoing clears the redo stack', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    setStickyColor(doc, id, 'blue');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(byId(doc, id)!.color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    moveObject(doc, id, 5, 5);

    expect(undo.canRedo()).toBe(false);
  });

  // TC-07: undo of a move whose target was deleted remotely (undo.safe)
  it('TC-07: undo of a move of a remotely-deleted note: no throw, stays deleted, next undo works', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = makePeer(doc);
    const undo = track(createUndo(doc));

    const idX = createSticky(doc, { x: 0, y: 0 });
    const idY = createSticky(doc, { x: 400, y: 0 });
    undo.boundary();

    moveObject(doc, idY, 410, 10);
    undo.boundary();
    moveObject(doc, idX, 10, 20);
    undo.boundary();

    // Peer deletes X
    peer.transact(() => {
      peer.getMap('objects').delete(idX);
    }, 'peer');

    // Undo the move of the now-deleted X: one step consumed, nothing visible
    expect(undo.undo()).toBe(true);
    expect(byId(doc, idX)).toBeUndefined();
    // Y is still at its moved position (the earlier step was not consumed)
    expect(byId(doc, idY)!.x).toBe(410);

    // The next undo continues normally: Y moves back to its original
    // center-anchored position (400,0) → (300,-100)
    expect(undo.undo()).toBe(true);
    expect(byId(doc, idY)!.x).toBe(300);
    expect(byId(doc, idY)!.y).toBe(-100);

    // The only remaining step is the (boundary-closed) note creation
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.undo()).toBe(false);
  });

  // TC-08: my delete undone → note restored with content at time of my delete
  it('TC-08: undo of my delete restores the note with the peer-edited content', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = makePeer(doc);
    const undo = track(createUndo(doc));

    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    // Peer edits the note's text
    const ptext = getStickyText(peer, id)!;
    ptext.insert(0, 'remote edit');

    // I delete it
    deleteObjects(doc, [id]);
    undo.boundary();

    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const restored = byId(doc, id)!;
    expect(restored.text).toBe('remote edit');
  });

  // TC-09: at UNDO_MAX_STEPS, a new step drops the oldest (undo.limit)
  it('TC-09: history capped at UNDO_MAX_STEPS; oldest step dropped', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: i * 260, y: 0 }));
      undo.boundary();
    }

    // Undo all steps: exactly UNDO_MAX_STEPS succeed
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo(), `undo ${i + 1} should succeed`).toBe(true);
    }
    expect(undo.undo()).toBe(false);

    // The oldest step was dropped: the first note survives
    expect(byId(doc, ids[0])).toBeDefined();
    for (let i = 1; i < ids.length; i++) {
      expect(byId(doc, ids[i]), `note ${i} should be gone`).toBeUndefined();
    }
  });

  // TC-10: at UNDO_MAX_STEPS − 1, one more step fills it without dropping
  it('TC-10: at UNDO_MAX_STEPS − 1, adding one step keeps every step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      ids.push(createSticky(doc, { x: i * 260, y: 0 }));
      undo.boundary();
    }

    // All UNDO_MAX_STEPS steps are undoable; nothing was dropped
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo(), `undo ${i + 1} should succeed`).toBe(true);
    }
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-11: history is session-only (undo.session_only)
  it('TC-11: a fresh controller after destroy starts empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));

    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 5, 5);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();

    const fresh = track(createUndo(doc));
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
  });
});
