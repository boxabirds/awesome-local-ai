/**
 * Story 8 — undo.history unit tests (TC-01..TC-11, task 6).
 *
 * Real Y.Doc + createUndo (Y.UndoManager). Remote changes are simulated with
 * a second connected Y.Doc (tests/unit/peer.ts): every update that reaches
 * the local doc from the peer carries a non-local origin, exactly like
 * updates arriving through the y-websocket provider.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
  snapshotAll,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyAsLoad, connectPeer, type Peer } from './peer';

let peer: Peer | null = null;
afterEach(() => {
  peer?.dispose();
  peer = null;
});

/** Local text insert under LOCAL_ORIGIN (tracked, like the real editor). */
function typeInto(doc: Y.Doc, id: string, text: string): void {
  const t = getStickyText(doc, id);
  if (t !== undefined) {
    doc.transact(() => {
      t.insert(t.length, text);
    }, LOCAL_ORIGIN);
  }
}

/** Compare the fields undo must restore exactly. */
function sameState(before: ObjectSnapshot, after: ObjectSnapshot): void {
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.z).toBe(before.z);
  expect(after.color).toBe(before.color);
  expect(after.text).toBe(before.text);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
}

describe('undo.history (TC-01..TC-11)', () => {
  it('TC-01: local move + peer create/recolour — one undo restores only the local move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    peer = connectPeer(doc);
    const undo = createUndo(doc);

    const x = createSticky(doc, { x: 0, y: 0 }, 'yellow'); // step 1
    undo.boundary();
    const z = createSticky(doc, { x: 100, y: 0 }, 'orange'); // step 2
    undo.boundary();

    // Meanwhile the peer works: creates Y and recolours Z (remote origin).
    const y = peer.createSticky({ x: 200, y: 0 }, 'blue');
    peer.recolor(z, 'pink');

    // Mia moves X (step 3, the latest local step).
    moveObjects(doc, new Map([[x, { x: 50, y: 0 }]]));
    undo.boundary();

    expect(undo.canUndo()).toBe(true);
    // One undo undoes the move — nothing the peer did is in Mia's stack, so
    // the latest step is hers.
    expect(undo.undo()).toBe(true);

    const after = snapshot(doc);
    const xa = after.find((o) => o.id === x)!;
    expect(xa.x).toBe(-100); // centre (0,0) again
    expect(xa.y).toBe(-100);
    // Y (created by the peer) is still there.
    expect(after.find((o) => o.id === y)).toBeDefined();
    // Z keeps the peer's colour.
    expect(after.find((o) => o.id === z)!.color).toBe('pink');
  });

  it('TC-02: peer-only changes never enter my stack', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    peer = connectPeer(doc);
    const undo = createUndo(doc);

    peer.createSticky({ x: 0, y: 0 }, 'blue');
    peer.recolor(peer.snapshot()[0].id, 'pink');
    peer.move(peer.snapshot()[0].id, { x: 40, y: 0 });

    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-03: the story-4 load path never enters my stack', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    // Build a two-note board elsewhere and load it under the load origin.
    const scratch = new Y.Doc();
    initDoc(scratch);
    createSticky(scratch, { x: 0, y: 0 }, 'yellow');
    createSticky(scratch, { x: 100, y: 0 }, 'pink');
    applyAsLoad(doc, Y.encodeStateAsUpdate(scratch));

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    scratch.destroy();
  });

  it('TC-04: delete 8 notes — undo restores all 8 with text, colour, size and position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 300, y: 0 }, colors[i % colors.length]);
      typeInto(doc, id, `note ${i}`);
      undo.boundary();
      ids.push(id);
    }
    // Varied sizes on three of them (created centres were i*300, so the
    // top-lefts are i*300-100).
    resizeObjects(doc, new Map([
      [ids[0], { x: -100, y: -100, width: 260, height: 260 }],
      [ids[1], { x: 200, y: -100, width: 140, height: 140 }],
      [ids[2], { x: 500, y: -100, width: 340, height: 340 }],
    ]));
    undo.boundary();

    const before = snapshotAll(doc);
    expect(before).toHaveLength(8);

    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshotAll(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      sameState(b, after.find((o) => o.id === b.id)!);
    }
  });

  it('TC-05: undo then redo re-applies the change', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const start = { x: -100, y: -100 };
    moveObjects(doc, new Map([[id, { x: start.x + 100, y: start.y }]]));
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(at(doc, id)).toEqual(start);
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(at(doc, id)).toEqual({ x: start.x + 100, y: start.y });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06: a new change after undo clears the redo stack', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const p0 = { x: -100, y: -100 };
    moveObjects(doc, new Map([[id, { x: p0.x + 100, y: p0.y }]])); // step 2
    undo.boundary();

    expect(undo.undo()).toBe(true); // move undone: back to p0
    expect(undo.canRedo()).toBe(true);

    // A new change (recolor) invalidates the redo stack.
    setStickyColor(doc, id, 'pink');
    undo.boundary();
    expect(undo.canRedo()).toBe(false);
    expect(undo.canUndo()).toBe(true);
    // The remaining undo steps still work: undoing the recolor keeps the
    // (undone) position and restores the original colour.
    expect(undo.undo()).toBe(true);
    expect(at(doc, id)).toEqual(p0);
    expect(snapshot(doc).find((o) => o.id === id)!.color).toBe('yellow');
  });

  it('TC-07: peer deletes my target — undo never throws, A stays deleted, the rest of the history works', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    peer = connectPeer(doc);
    const undo = createUndo(doc);

    const a = createSticky(doc, { x: 0, y: 0 }); // step 1
    undo.boundary();
    const b = createSticky(doc, { x: 300, y: 0 }, 'orange'); // step 2
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 50, y: -100 }]])); // step 3 (moves the doomed A)
    undo.boundary();
    setStickyColor(doc, b, 'pink'); // step 4
    undo.boundary();

    peer.deleteNote(a);
    expect(snapshot(doc).find((o) => o.id === a)).toBeUndefined();

    // Undo 1: the recolor of B (a live step) still undoes.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).find((o) => o.id === b)!.color).toBe('orange');

    // Undo 2: A's move has no effect (A is gone) — no exception, A stays
    // deleted; the no-op step is skipped and the next one (B's creation)
    // undoes for real.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).find((o) => o.id === a)).toBeUndefined();
    expect(snapshot(doc).find((o) => o.id === b)).toBeUndefined();

    // Undo 3: A's creation is a no-op too (already deleted) — no error,
    // history simply exhausted.
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc).find((o) => o.id === a)).toBeUndefined();
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-08: peer edits my note, I delete it — undo restores it with the content at deletion', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    peer = connectPeer(doc);
    const undo = createUndo(doc);

    const a = createSticky(doc, { x: 0, y: 0 });
    typeInto(doc, a, 'base');
    undo.boundary();

    peer.appendText(a, ' +peer');
    expect(getStickyText(doc, a)!.toString()).toBe('base +peer');

    deleteObjects(doc, [a]);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(a);
    expect(after[0].text).toBe('base +peer');
    expect(after[0].x).toBe(-100);
    expect(after[0].color).toBe('yellow');
  });

  it('TC-09: at 201 steps the oldest is dropped; the rest still undo in order', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    const n = UNDO_MAX_STEPS + 1;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = createSticky(doc, { x: i * 300, y: 0 });
      typeInto(doc, id, `n${i}`); // same ms as the create: one merged step
      undo.boundary();
      ids.push(id);
    }

    // 200 steps remain (the oldest, n0's, was dropped).
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(undo.canUndo()).toBe(false);
    const left = snapshot(doc);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(ids[0]);
    expect(left[0].text).toBe('n0');
  });

  it('TC-10: at exactly 200 steps nothing is dropped', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      const id = createSticky(doc, { x: i * 300, y: 0 });
      typeInto(doc, id, `n${i}`);
      undo.boundary();
    }

    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      expect(undo.undo()).toBe(true);
    }
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-11: history is session-only — a fresh controller starts empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const first = createUndo(doc);
    createSticky(doc, { x: 0, y: 0 });
    expect(first.canUndo()).toBe(true);

    first.destroy();
    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
  });
});

function at(doc: Y.Doc, id: string): { x: number; y: number } {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  return { x: entry?.get('x') as number, y: entry?.get('y') as number };
}
