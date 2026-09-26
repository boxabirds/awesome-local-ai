import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  setStickyColor,
  deleteObjects,
  getStickyText,
  snapshot,
} from '@/shared/board-model';
import { createUndo } from '@/client/board/undo';
import { UNDO_MAX_STEPS } from '@/shared/config';
import { createPeer, applyRemoteUpdate, LOAD_ORIGIN } from './peer';

/**
 * Story 8: per-user undo history (undo.history).
 *
 * Every test runs the real {@link Y.Doc} and the real {@link Y.UndoManager}
 * behind {@link createUndo}. "Remote" changes are applied with a non-local
 * origin (simulated peer) or the story 4 LOAD origin, and must never enter the
 * local undo/redo stacks.
 */

/** Builds a fully-attributed sticky on `d` (used to seed remote boards). */
function makeNote(
  d: Y.Doc,
  x: number,
  y: number,
  color: string,
  text: string,
  w: number,
  h: number,
): string {
  const id = createSticky(d, { x, y }, color as never);
  d.transact(() => {
    const o = d.getMap('objects').get(id) as Y.Map<unknown>;
    (o.get('text') as Y.Text).insert(0, text);
    o.set('width', w);
    o.set('height', h);
  }, 'test-seed');
  return id;
}

describe('per-user undo history (undo.history)', () => {
  it('TC-01: undo reverses my move only; a peer create and recolour stay', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = createPeer();

    // I create X and move it (my step).
    const xId = createSticky(doc, { x: 0, y: 0 });
    c.boundary();
    const before = snapshot(doc).find((n) => n.id === xId)!;
    moveObject(doc, xId, before.x + 300, before.y);
    c.boundary();

    // The peer creates Y and recolours Z.
    const yId = createSticky(peer.doc, { x: 500, y: 0 });
    const zId = createSticky(peer.doc, { x: 700, y: 0 });
    setStickyColor(peer.doc, zId, 'pink');
    peer.pushTo(doc);

    expect(c.canUndo()).toBe(true);
    expect(c.undo()).toBe(true);

    const after = snapshot(doc);
    expect(after.find((n) => n.id === xId)!.x).toBe(before.x); // X restored
    expect(after.some((n) => n.id === yId)).toBe(true); // Y still exists
    expect(after.find((n) => n.id === zId)!.color).toBe('pink'); // Z keeps peer colour
  });

  it('TC-02: peer-only changes never enter my history', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = createPeer();

    createSticky(peer.doc, { x: 0, y: 0 });
    peer.pushTo(doc);

    expect(c.canUndo()).toBe(false);
    expect(c.undo()).toBe(false);
  });

  it('TC-03: load-origin updates never enter my history', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    const scratch = new Y.Doc();
    scratch.getMap('objects');
    createSticky(scratch, { x: 0, y: 0 });
    applyRemoteUpdate(doc, Y.encodeStateAsUpdate(scratch), LOAD_ORIGIN);

    expect(c.canUndo()).toBe(false);
    expect(c.undo()).toBe(false);
  });

  it('TC-04: deleting 8 notes, one undo restores all with text, colour, size, position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = createPeer();

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'orange'];
    const texts = ['a', 'bb', 'ccc', 'dddd', 'eeee', 'ffff', 'gggg', 'hhhhh'];
    const widths = [100, 110, 120, 130, 140, 150, 160, 170];
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(makeNote(peer.doc, i * 250, 0, colors[i], texts[i], widths[i], widths[i] + 20));
    }
    peer.pushTo(doc);
    expect(snapshot(doc)).toHaveLength(8);
    const before = snapshot(doc);

    // I delete all 8 in one action (one step).
    c.boundary();
    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);
    expect(c.canUndo()).toBe(true);

    expect(c.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      const n = after.find((s) => s.id === ids[i])!;
      const b = before.find((s) => s.id === ids[i])!;
      expect(n.text).toBe(texts[i]);
      expect(n.color).toBe(colors[i]);
      expect(n.width).toBe(widths[i]);
      expect(n.height).toBe(widths[i] + 20);
      expect(n.x).toBe(b.x);
      expect(n.y).toBe(b.y);
    }
  });

  it('TC-05: undo then redo re-applies the move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    const id = createSticky(doc, { x: 0, y: 0 });
    c.boundary();
    const before = snapshot(doc).find((n) => n.id === id)!;
    moveObject(doc, id, before.x + 200, before.y + 50);
    c.boundary();

    expect(c.undo()).toBe(true);
    let n = snapshot(doc).find((s) => s.id === id)!;
    expect(n.x).toBe(before.x);
    expect(n.y).toBe(before.y);

    expect(c.redo()).toBe(true);
    n = snapshot(doc).find((s) => s.id === id)!;
    expect(n.x).toBe(before.x + 200);
    expect(n.y).toBe(before.y + 50);
  });

  it('TC-06: a new change after undo clears the redo history', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    const id = createSticky(doc, { x: 0, y: 0 });
    c.boundary();
    setStickyColor(doc, id, 'pink');
    c.boundary();

    expect(c.undo()).toBe(true);
    expect(snapshot(doc).find((s) => s.id === id)!.color).toBe('yellow');
    expect(c.canRedo()).toBe(true);

    // A new change discards the redo history.
    setStickyColor(doc, id, 'blue');
    expect(c.canRedo()).toBe(false);
  });

  it('TC-07: undoing a move of a remotely-deleted note is a safe no-op; the next undo works', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = createPeer();

    // Seed three notes remotely.
    const nId = createSticky(peer.doc, { x: 0, y: 0 });
    const pId = createSticky(peer.doc, { x: 300, y: 0 });
    const qId = createSticky(peer.doc, { x: 600, y: 0 });
    peer.pushTo(doc);

    // I move Q, then P, then N (N is my most recent step).
    c.boundary();
    moveObject(doc, qId, 650, 0);
    c.boundary();
    moveObject(doc, pId, 350, 0);
    c.boundary();
    moveObject(doc, nId, 50, 0);
    c.boundary();

    // The peer deletes N.
    peer.doc.transact(() => {
      peer.doc.getMap('objects').delete(nId);
    }, 'peeredit');
    peer.pushTo(doc);
    expect(doc.getMap('objects').has(nId)).toBe(false);

    // Undoing my move of the (now deleted) N must not throw and must not
    // resurrect N.
    expect(() => c.undo()).not.toThrow();
    expect(doc.getMap('objects').has(nId)).toBe(false);

    // The no-op step is transparent: the previous real step (my move of P) is
    // reversed. (P was created centred at x=300 -> top-left x=200.)
    expect(snapshot(doc).find((s) => s.id === pId)!.x).toBe(200);

    // The history is still usable: the next undo reverses my move of Q.
    // (Q was created centred at x=600 -> top-left x=500.)
    expect(c.undo()).toBe(true);
    expect(snapshot(doc).find((s) => s.id === qId)!.x).toBe(500);
  });

  it('TC-08: undoing my delete restores the note with its content at delete time', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = createPeer();

    const id = createSticky(peer.doc, { x: 0, y: 0 });
    peer.pushTo(doc);

    // The peer edits the note text while it exists.
    peer.doc.transact(() => {
      getStickyText(peer.doc, id)!.insert(0, 'peer text');
    }, 'peeredit');
    peer.pushTo(doc);
    expect(getStickyText(doc, id)!.toString()).toBe('peer text');

    // I delete the note (one step).
    c.boundary();
    deleteObjects(doc, [id]);
    expect(doc.getMap('objects').has(id)).toBe(false);

    // Undo brings it back with the content it had at the time of my delete.
    expect(c.undo()).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(true);
    expect(getStickyText(doc, id)!.toString()).toBe('peer text');
  });

  it('TC-09: at UNDO_MAX_STEPS + 1 the oldest step is dropped (length stays bounded)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      createSticky(doc, { x: i * 10, y: 0 });
      c.boundary();
    }

    let count = 0;
    while (c.canUndo()) {
      expect(c.undo()).toBe(true);
      count += 1;
      if (count > UNDO_MAX_STEPS + 5) throw new Error('history not bounded');
    }
    expect(count).toBe(UNDO_MAX_STEPS);

    // The oldest note (i=0) was dropped from the history, so it survives.
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].x).toBe(-100); // createSticky centres on (0,0)
  });

  it('TC-10: at exactly UNDO_MAX_STEPS nothing is dropped', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i * 10, y: 0 });
      c.boundary();
    }

    let count = 0;
    while (c.canUndo()) {
      expect(c.undo()).toBe(true);
      count += 1;
      if (count > UNDO_MAX_STEPS + 5) throw new Error('history not bounded');
    }
    expect(count).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0); // every note was undoable
  });

  it('TC-11: a fresh controller after destroy starts empty (session-only history)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    createSticky(doc, { x: 0, y: 0 });
    expect(c.canUndo()).toBe(true);
    c.destroy();

    const c2 = createUndo(doc);
    expect(c2.canUndo()).toBe(false);
    expect(c2.undo()).toBe(false);
    c2.destroy();
  });
});
