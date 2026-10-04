/**
 * Story 8 — undo.history unit tests (TC-01 to TC-11).
 *
 * Real Y.Docs and a real UndoController; a simulated remote peer
 * (tests/unit/peer.ts) delivers remote changes with a non-local origin, and
 * `applyLoadUpdate` applies story 4 load updates.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  deleteObjects,
  resizeObjects,
  getStickyText,
  snapshot,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createPeer, applyLoadUpdate, type Peer } from './peer';
import type { Rect } from '../../src/shared/geometry';

interface Env {
  doc: Y.Doc;
  undo: UndoController;
  peers: Peer[];
}

function makeEnv(): Env {
  const doc = new Y.Doc();
  initDoc(doc);
  return { doc, undo: createUndo(doc), peers: [] };
}

function addPeer(env: Env): Peer {
  const peer = createPeer(env.doc);
  env.peers.push(peer);
  return peer;
}

/** Find a note in the current snapshot by id. */
function note(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

// ─── TC-01: local move undone; peer's create and recolour stay ─────────────
describe('TC-01: undo reverses only my change', () => {
  it('A moves X; peer creates Y, recolours Z; A undo → X restored, Y exists, Z keeps peer colour', () => {
    const env = makeEnv();
    const { doc, undo } = env;
    const x = createSticky(doc, { x: 100, y: 0 }, 'yellow');
    const z = createSticky(doc, { x: 500, y: 0 }, 'yellow');
    undo.boundary();

    const peer = addPeer(env);
    peer.apply((p) => {
      createSticky(p, { x: 900, y: 0 }, 'blue'); // peer creates Y
      setStickyColor(p, z, 'pink'); // peer recolours Z
    });

    const xBefore = note(doc, x)!;
    moveObject(doc, x, xBefore.x + 75, xBefore.y + 25);
    undo.boundary();

    expect(undo.undo()).toBe(true);

    const after = snapshot(doc);
    const nx = note(doc, x)!;
    expect({ x: nx.x, y: nx.y }).toEqual({ x: xBefore.x, y: xBefore.y });
    // Y (peer's note) still exists
    expect(after.filter((n) => n.x === 900 - 100 && n.y === -100)).toHaveLength(1);
    // Z keeps the peer's colour
    expect(note(doc, z)!.color).toBe('pink');
    // negative: the peer's changes were not reversed
    expect(after).toHaveLength(3);
  });
});

// ─── TC-02: remote-only changes → nothing to undo ──────────────────────────
describe('TC-02: peer changes only → canUndo false', () => {
  it('only peer changes → canUndo false, undo false', () => {
    const env = makeEnv();
    const { doc, undo } = env;
    const peer = addPeer(env);
    peer.apply((p) => {
      createSticky(p, { x: 0, y: 0 }, 'blue');
      createSticky(p, { x: 300, y: 0 }, 'pink');
    });
    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});

// ─── TC-03: load-origin updates → nothing to undo ──────────────────────────
describe('TC-03: load updates not captured', () => {
  it('updates applied with LOAD origin → canUndo false', () => {
    const { doc, undo } = makeEnv();
    const scratch = new Y.Doc();
    const id = createSticky(scratch, { x: 12, y: 34 }, 'green');
    applyLoadUpdate(doc, Y.encodeStateAsUpdate(scratch));
    scratch.destroy();

    expect(note(doc, id)).toBeDefined();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});

// ─── TC-04: delete 8 notes, undo restores all of them ──────────────────────
describe('TC-04: undo restores a delete of 8 notes', () => {
  it('delete 8 notes, undo → 8 restored with text, colour, size, position', () => {
    const { doc, undo } = makeEnv();
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'orange'];
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: 200 + i * 300, y: 100 }, colors[i]);
      doc.transact(() => getStickyText(doc, id)!.insert(0, `note ${i}`), LOCAL_ORIGIN);
      ids.push(id);
    }
    // Give each note a distinct size.
    const rects = new Map<string, Rect>();
    for (let i = 0; i < 8; i++) {
      const n = note(doc, ids[i])!;
      rects.set(ids[i], { x: n.x, y: n.y, width: 100 + i * 10, height: 60 + i * 5 });
    }
    resizeObjects(doc, rects);
    undo.boundary();

    const before = snapshot(doc);
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toEqual(before);
  });
});

// ─── TC-05: undo then redo re-applies ──────────────────────────────────────
describe('TC-05: redo re-applies the undone step', () => {
  it('undo then redo → position re-applied', () => {
    const { doc, undo } = makeEnv();
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const before = note(doc, id)!;
    moveObject(doc, id, before.x + 42, before.y + 24);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(note(doc, id)!.x).toBe(before.x);
    expect(note(doc, id)!.y).toBe(before.y);

    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(doc, id)!.x).toBe(before.x + 42);
    expect(note(doc, id)!.y).toBe(before.y + 24);
    expect(undo.canRedo()).toBe(false);
  });
});

// ─── TC-06: new change after undo clears redo ──────────────────────────────
describe('TC-06: new change clears redo', () => {
  it('undo, then new change → canRedo false', () => {
    const { doc, undo } = makeEnv();
    const id = createSticky(doc, { x: 0, y: 0 }, 'yellow');
    undo.boundary();
    setStickyColor(doc, id, 'blue');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(note(doc, id)!.color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    const n = note(doc, id)!;
    moveObject(doc, id, n.x + 5, n.y + 5);
    expect(undo.canRedo()).toBe(false);
  });
});

// ─── TC-07: undo of a move whose target was deleted remotely ───────────────
describe('TC-07: undo never breaks on remotely deleted objects', () => {
  it('local move, peer deletes target, undo → no throw, stays deleted, next undo works', () => {
    const env = makeEnv();
    const { doc, undo } = env;
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    undo.boundary();

    const aBefore = note(doc, a)!;
    moveObject(doc, a, aBefore.x + 10, aBefore.y + 10);
    undo.boundary();

    const bBefore = note(doc, b)!;
    moveObject(doc, b, bBefore.x + 20, bBefore.y + 20);
    undo.boundary();

    const peer = addPeer(env);
    peer.apply((p) => {
      (p.getMap('objects') as Y.Map<Y.Map<unknown>>).delete(a);
    });
    expect(note(doc, a)).toBeUndefined();

    // First undo restores b's move (top of the stack).
    expect(undo.undo()).toBe(true);
    expect(note(doc, b)!.x).toBe(bBefore.x);
    expect(note(doc, b)!.y).toBe(bBefore.y);

    // Second undo is the move of the (remotely deleted) note a: no throw,
    // no recreation, step consumed.
    expect(() => undo.undo()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(note(doc, a)).toBeUndefined();
  });
});

// ─── TC-08: undoing my delete restores content at time of delete ──────────
describe('TC-08: undo of my delete restores peer-edited content', () => {
  it('peer edits note text, local delete, undo → restored with content at time of delete', () => {
    const env = makeEnv();
    const { doc, undo } = env;
    const id = createSticky(doc, { x: 0, y: 0 }, 'violet');
    undo.boundary();

    const peer = addPeer(env);
    peer.apply((p) => {
      const obj = (p.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id) as Y.Map<unknown>;
      (obj.get('text') as Y.Text).insert(0, 'peer edit');
    });
    expect(note(doc, id)!.text).toBe('peer edit');
    undo.boundary();

    deleteObject(doc, id);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const restored = note(doc, id)!;
    expect(restored.text).toBe('peer edit');
    expect(restored.color).toBe('violet');
  });
});

// ─── TC-09: at UNDO_MAX_STEPS, the oldest step is discarded ────────────────
describe('TC-09: history length capped at UNDO_MAX_STEPS', () => {
  it(`add ${UNDO_MAX_STEPS + 1} steps → length stays ${UNDO_MAX_STEPS}, oldest gone`, () => {
    const { doc, undo } = makeEnv();
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: i * 300, y: 0 }));
      undo.boundary();
    }

    // Undo every remaining step: exactly UNDO_MAX_STEPS succeed.
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo(), `undo #${i + 1} should succeed`).toBe(true);
    }
    expect(undo.undo()).toBe(false);

    // The oldest step (ids[0]) was discarded, so its note survives.
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(ids[0]);
  });
});

// ─── TC-10: at UNDO_MAX_STEPS − 1, nothing is dropped ──────────────────────
describe('TC-10: below the cap nothing is dropped', () => {
  it(`add ${UNDO_MAX_STEPS} steps → all ${UNDO_MAX_STEPS} undoable`, () => {
    const { doc, undo } = makeEnv();
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i * 300, y: 0 });
      undo.boundary();
    }
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo(), `undo #${i + 1} should succeed`).toBe(true);
    }
    expect(snapshot(doc)).toHaveLength(0);
  });
});

// ─── TC-11: history does not survive a reload (new controller) ─────────────
describe('TC-11: fresh controller starts empty (session only)', () => {
  it('destroy controller and create new → canUndo false', () => {
    const { doc, undo } = makeEnv();
    createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    fresh.destroy();
  });
});
