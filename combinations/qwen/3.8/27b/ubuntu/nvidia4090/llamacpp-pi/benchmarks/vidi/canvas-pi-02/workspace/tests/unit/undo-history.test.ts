import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { buildNotes, LOAD_ORIGIN, TestPeer } from './peer';

/**
 * undo.history (story 8, task 6): the per-user undo contract of
 * `createUndo` — undo, redo, boundary, canUndo, canRedo, onChange, destroy —
 * tested against a real Y.Doc with a simulated remote peer (TestPeer).
 *
 * Every "user action" below is bracketed with `undo.boundary()` exactly as
 * the client wiring does (task 8), so each action is one step even when the
 * test runs faster than the capture window.
 */

/** Top-left of one object from the doc (throws if missing). */
const topLeft = (doc: Y.Doc, id: string): { x: number; y: number } => {
  const o = snapshot(doc).find((n) => n.id === id);
  if (o === undefined) throw new Error(`note ${id} missing`);
  return { x: o.x, y: o.y };
};

const find = (doc: Y.Doc, id: string) => snapshot(doc).find((n) => n.id === id);

describe('undo.history (TC-01 to TC-11)', () => {
  it('TC-01 local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);

    const x = createSticky(doc, { x: 0, y: 0 }); // top-left (-100, -100)
    const z = createSticky(doc, { x: 400, y: 0 });

    undo.boundary();
    moveObjects(doc, new Map([[x, { x: 100, y: 50 }]]));
    undo.boundary();

    // The colleague works: adds Y and recolours Z. Neither may be undoable.
    peer.peer((rd) => {
      createSticky(rd, { x: 800, y: 0 });
      setStickyColor(rd, z, 'blue');
    });

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    expect(topLeft(doc, x)).toEqual({ x: -100, y: -100 }); // my move reverted
    expect(find(doc, z)?.color).toBe('blue'); // peer colour untouched
    const y = snapshot(doc).find((o) => o.id !== x && o.id !== z);
    expect(y).toBeDefined(); // the peer's note survives
  });

  it('TC-02 only peer changes → canUndo false', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);

    // The whole board is written by the peer: nothing of mine to undo.
    peer.peer((rd) => {
      createSticky(rd, { x: 0, y: 0 });
      createSticky(rd, { x: 300, y: 0 });
    });
    expect(snapshot(doc)).toHaveLength(2);

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2); // the notes are still there
  });

  it('TC-03 LOAD-origin updates → canUndo false', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);

    // A story 4 board load: the room's initial state arrives with LOAD_ORIGIN.
    const source = new Y.Doc();
    initDoc(source);
    createSticky(source, { x: 0, y: 0 });
    createSticky(source, { x: 300, y: 0 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2); // nothing was reverted
  });

  it('TC-04 delete 8 notes, undo → all restored with text, colour, size, position', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);

    const specs = Array.from({ length: 8 }, (_, i) => ({
      x: (i % 4) * 300,
      y: Math.floor(i / 4) * 300,
      text: `note ${i}`,
      color: (['yellow', 'blue', 'green', 'pink'] as const)[i % 4]!,
      width: 150 + i * 10,
      height: 120 + i * 5,
    }));
    const ids = buildNotes(doc, specs);
    const before: Record<string, ObjectSnapshot> = {};
    for (const o of snapshot(doc)) before[o.id] = o;

    undo.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const i of ids) {
      const o = find(doc, i)!;
      // Every field round-trips through the delete/undo, id for id.
      expect({ x: o.x, y: o.y, text: o.text, color: o.color, width: o.width, height: o.height }).toEqual({
        x: before[i]!.x,
        y: before[i]!.y,
        text: before[i]!.text,
        color: before[i]!.color,
        width: before[i]!.width,
        height: before[i]!.height,
      });
    }
  });

  it('TC-05 undo then redo → re-applied', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 50, y: 60 }]]));
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(topLeft(doc, a)).toEqual({ x: -100, y: -100 });

    expect(undo.redo()).toBe(true);
    expect(topLeft(doc, a)).toEqual({ x: 50, y: 60 });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06 undo then new change → canRedo false', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 50, y: 60 }]]));
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    // A new own step clears the redo stack (undo.redo_cleared).
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 70, y: 70 }]]));
    undo.boundary();
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(topLeft(doc, a)).toEqual({ x: 70, y: 70 }); // the new move stands
  });

  it('TC-07 local move, peer deletes target, undo → no throw, still deleted, next undo works (error path)', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 10, y: 10 }]]));
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 20, y: 20 }]]));
    undo.boundary();

    // The colleague deletes the note I just moved.
    peer.peer((rd) => {
      deleteObjects(rd, [a]);
    });
    expect(snapshot(doc)).toHaveLength(0);

    // Undoing my moves must not throw and must not resurrect the note.
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    // The mechanism keeps working afterwards.
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-08 peer edits note text, then local delete, undo → restored with content at time of delete', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    // My seeded text, written as a local (user) write so the TestPeer relays
    // it to the peer. A null-origin write would never reach the peer, making
    // the peer's 'peer ' insert concurrent with 'base' and the merged order
    // depend on the (random) client ids — a flaky assertion.
    doc.transact(() => {
      getStickyText(doc, a)!.insert(0, 'base');
    }, LOCAL_ORIGIN);

    // The colleague edits the text.
    peer.peer((rd) => {
      getStickyText(rd, a)!.insert(0, 'peer ');
    });
    expect(getStickyText(doc, a)!.toString()).toBe('peer base');

    undo.boundary();
    expect(deleteObjects(doc, [a])).toBe(1);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    const o = find(doc, a)!;
    expect(o.text).toBe('peer base'); // content exactly as at the time of the delete
    expect(topLeft(doc, a)).toEqual({ x: -100, y: -100 });
  });

  it('TC-09 UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 }); // top-left (-100, -100)

    for (let i = 1; i <= UNDO_MAX_STEPS + 1; i++) {
      undo.boundary();
      moveObjects(doc, new Map([[a, { x: -100 + i, y: -100 }]]));
      undo.boundary();
    }
    expect(topLeft(doc, a).x).toBe(-100 + UNDO_MAX_STEPS + 1);

    // Exactly UNDO_MAX_STEPS undos are available: the oldest step was dropped.
    let undos = 0;
    while (undo.undo()) undos++;
    expect(undos).toBe(UNDO_MAX_STEPS);
    expect(topLeft(doc, a).x).toBe(-100 + 1); // the first move was never undone
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-10 UNDO_MAX_STEPS − 1 + 1 steps → nothing dropped (boundary)', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const undo = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 }); // top-left (-100, -100)

    for (let i = 1; i <= UNDO_MAX_STEPS; i++) {
      undo.boundary();
      moveObjects(doc, new Map([[a, { x: -100 + i, y: -100 }]]));
      undo.boundary();
    }

    let undos = 0;
    while (undo.undo()) undos++;
    expect(undos).toBe(UNDO_MAX_STEPS); // every step survived the trim
    expect(topLeft(doc, a).x).toBe(-100); // fully back to the start
  });

  it('TC-11 destroy then new controller → canUndo false (session only)', () => {
    const peer = new TestPeer();
    const doc = peer.local;
    const first = createUndo(doc);
    const a = createSticky(doc, { x: 0, y: 0 });

    first.boundary();
    moveObjects(doc, new Map([[a, { x: 10, y: 10 }]]));
    first.boundary();
    expect(first.canUndo()).toBe(true);

    first.destroy();
    expect(first.canUndo()).toBe(false);
    expect(first.undo()).toBe(false);

    // History is session-only: a fresh controller on the same doc starts empty.
    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
    expect(topLeft(doc, a)).toEqual({ x: 10, y: 10 }); // the board is untouched
    second.destroy();
  });
});
