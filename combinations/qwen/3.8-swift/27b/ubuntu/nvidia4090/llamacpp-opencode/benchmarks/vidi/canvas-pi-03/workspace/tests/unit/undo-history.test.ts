/**
 * Story 8 — undo.history (unit, TC-01 to TC-11): the per-user UndoController
 * over a real Y.Doc, with a simulated remote peer (second real Y.Doc,
 * non-local origin) and a story 4 LOAD origin.
 *
 * The controller is the behaviour under test: real Y.Doc + Y.UndoManager,
 * only LOCAL_ORIGIN transactions are captured (undo.own), history is trimmed
 * to UNDO_MAX_STEPS (undo.limit) and session-only (undo.session_only).
 *
 * Step separation uses `boundary()` (the same mechanism the app wires at
 * gesture/edit/action edges), which is deterministic — no clock involved.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyColor,
  getStickyText,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from 'src/shared/board-model';
import { UNDO_MAX_STEPS } from 'src/shared/config';
import { createUndo } from 'src/client/board/undo';
import { createPeer } from './peer';

function note(doc: Y.Doc, id: string, x = 0, y = 0): string | null {
  const created = createSticky(doc, { x, y }, 'yellow', id);
  if (created) getStickyText(doc, id)?.insert(0, `text-${id}`);
  return created;
}

/** Snapshot of one note's full content (position, size, colour, text). */
function full(doc: Y.Doc, id: string): Pick<StickySnapshot, 'x' | 'y' | 'color' | 'text'> {
  const s = snapshot(doc).find((n) => n.id === id)!;
  return { x: s.x, y: s.y, color: s.color, text: s.text };
}

describe('undo.history (unit)', () => {
  it('TC-01: local move + peer create/recolour → undo restores only the local move', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    note(doc, 'a', 0, 0);
    note(doc, 'z', 300, 0);
    undo.boundary();

    // Local: move A. Peer (in between): create B and recolour Z.
    const aBefore = full(doc, 'a');
    moveObjects(doc, new Map([['a', { x: 10, y: -5 }]]));
    peer.createSticky('b', { x: -300, y: 0 }, 'green');
    peer.setStickyColor('z', 'blue');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    // A is back at its old position.
    expect(full(doc, 'a')).toEqual(aBefore);
    // The peer's work is intact: B exists, Z keeps the peer's colour.
    expect(snapshot(doc).some((n) => n.id === 'b')).toBe(true);
    expect(getStickyColor(doc, 'z')).toBe('blue');
  });

  it('TC-02: peer changes only → canUndo false (remote not captured)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    // Every change on the board is the peer's (never LOCAL_ORIGIN).
    peer.createSticky('a', { x: 0, y: 0 });
    peer.createSticky('b', { x: -100, y: 0 });
    peer.setStickyColor('a', 'blue');
    peer.moveObject('a', 11, 22);
    peer.insertText('a', 'peer-text');

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates → canUndo false (story 4 load not captured)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    // A server doc whose state is "loaded" into the local doc.
    const serverDoc = new Y.Doc();
    note(serverDoc, 'a', 0, 0);
    peer.loadFrom(serverDoc);

    expect(snapshot(doc).map((n) => n.id)).toEqual(['a']);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-04: delete 8 notes, undo → all 8 restored with text, colour, size, position', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 220, y: 0 }, colors[i % colors.length], `n${i}`)!;
      getStickyText(doc, id)?.insert(0, `note ${i}`);
      // Give every note an explicit, distinct size.
      resizeObjects(doc, new Map([[id, { x: i * 220, y: 0, width: 100 + i * 10, height: 150 + i * 5 }]]));
      undo.boundary(); // one step per created note
      ids.push(id);
    }
    const before = new Map(ids.map((id) => [id, full(doc, id)]));

    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = new Map(snapshot(doc).map((n) => [n.id, full(doc, n.id)]));
    expect(after.size).toBe(8);
    for (const id of ids) {
      expect(after.get(id)).toEqual(before.get(id));
    }
  });

  it('TC-05: undo then redo → position re-applied', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    note(doc, 'a', 0, 0);
    undo.boundary();

    const start = full(doc, 'a');
    moveObjects(doc, new Map([['a', { x: 50, y: 60 }]]));
    undo.boundary();
    moveObjects(doc, new Map([['a', { x: 90, y: 90 }]]));

    expect(undo.undo()).toBe(true);
    expect(full(doc, 'a')).toEqual({ x: 50, y: 60, color: 'yellow', text: 'text-a' });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(full(doc, 'a')).toEqual({ x: 90, y: 90, color: 'yellow', text: 'text-a' });
    expect(undo.canRedo()).toBe(false);
    // Redoing puts the step back on the undo stack.
    expect(undo.undo()).toBe(true);
    expect(full(doc, 'a')).toEqual({ x: 50, y: 60, color: 'yellow', text: 'text-a' });
    expect(undo.canRedo()).toBe(true);
    // (start pins the pre-move state)
    expect(start).toEqual({ x: -100, y: -100, color: 'yellow', text: 'text-a' });
  });

  it('TC-06: colour, undo, then a new change → canRedo false (redo cleared)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    note(doc, 'a', 0, 0);
    undo.boundary();

    expect(setStickyColor(doc, 'a', 'blue')).toBe(true);
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    expect(getStickyColor(doc, 'a')).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    // A new local change discards the redo history.
    moveObjects(doc, new Map([['a', { x: 5, y: 5 }]]));
    expect(undo.canRedo()).toBe(false);
    // The new change is itself undoable.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    const s = snapshot(doc).find((n) => n.id === 'a')!;
    expect(s.x).toBe(-100);
    expect(s.y).toBe(-100);
  });

  it('TC-07: undo of a move whose target was deleted remotely → no throw, stays deleted, history usable', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const peer = createPeer(doc);
    note(doc, 'a', 0, 0);
    undo.boundary();
    note(doc, 'b', 300, 0);
    undo.boundary();

    // Mia: move A (step 1), then move B (step 2). Raj deletes A.
    moveObjects(doc, new Map([['a', { x: 10, y: 10 }]]));
    undo.boundary();
    moveObjects(doc, new Map([['b', { x: 310, y: 310 }]]));
    undo.boundary();
    peer.deleteObject('a');

    // Undo the move of B (top of the stack) — applies normally.
    expect(undo.undo()).toBe(true);
    expect(full(doc, 'b')).toEqual({ x: 200, y: -100, color: 'yellow', text: 'text-b' });
    expect(snapshot(doc).some((n) => n.id === 'a')).toBe(false);

    // Undo the move of A: the target was deleted by someone else → the step
    // is consumed, nothing is applied, and no throw (undo.safe).
    expect(() => {
      expect(undo.undo()).toBe(false);
    }).not.toThrow();
    expect(snapshot(doc).some((n) => n.id === 'a')).toBe(false); // NOT recreated
    expect(full(doc, 'b').x).toBe(200); // previous step's effect intact
    // The history is still usable: the older own steps are still on the stack.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true); // undoes B's creation
    expect(snapshot(doc).some((n) => n.id === 'b')).toBe(false);
  });

  it('TC-08: peer edits text, then I delete → undo restores the content at time of my delete', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const peer = createPeer(doc);
    note(doc, 'a', 0, 0);
    undo.boundary();

    // Raj keeps typing into the note before Mia deletes it.
    peer.insertText('a', ' raj-typed');
    expect(getStickyText(doc, 'a')?.toString()).toBe(' raj-typedtext-a');

    expect(deleteObjects(doc, ['a'])).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);
    // Restored with its content AS OF MY DELETE (including Raj's edits).
    expect(full(doc, 'a')).toEqual({ x: -100, y: -100, color: 'yellow', text: ' raj-typedtext-a' });
  });

  it('TC-09: UNDO_MAX_STEPS + 1 steps → length stays UNDO_MAX_STEPS, oldest dropped', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      const id = createSticky(doc, { x: i, y: 0 }, 'yellow', `s${i}`)!;
      ids.push(id);
      undo.boundary(); // one step per create
    }

    // The stack is trimmed to UNDO_MAX_STEPS; the oldest step (s0) is dropped.
    expect(undo.stackLength()).toBe(UNDO_MAX_STEPS);

    // Undoing UNDO_MAX_STEPS times deletes s1..s200; s0 was dropped and stays.
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    const remaining = snapshot(doc).map((n) => n.id);
    expect(remaining).toEqual(['s0']);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-10: UNDO_MAX_STEPS − 1 steps + 1 → length UNDO_MAX_STEPS, nothing dropped', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      const id = createSticky(doc, { x: i, y: 0 }, 'yellow', `s${i}`)!;
      ids.push(id);
      undo.boundary(); // one step per create
    }

    expect(undo.stackLength()).toBe(UNDO_MAX_STEPS);
    // Nothing dropped: every step is still undoable (all notes get deleted).
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-11: destroy then a fresh controller (reload) → canUndo false (session only)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    note(doc, 'a', 0, 0);

    expect(undo.canUndo()).toBe(true);
    undo.destroy();

    // A fresh controller (like a page reload) starts with an empty history.
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    fresh.destroy();
  });
});
