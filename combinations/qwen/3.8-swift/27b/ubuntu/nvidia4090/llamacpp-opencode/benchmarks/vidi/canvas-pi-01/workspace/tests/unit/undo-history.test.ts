// undo.history (story 8): TC-01 to TC-11.
//
// Per-user undo over real Y.Docs. The remote peer is a second real Y.Doc
// exchanging updates through a non-local origin (tests/unit/peer.ts), exactly
// like the y-websocket provider delivers remote changes.

import { describe, expect, it } from 'vitest';
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
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { applyLoad, createPeer } from './peer';

/**
 * Local doc + simulated peer + controller.
 *
 * The peer's update listeners are registered BEFORE any mutation (including
 * initDoc) so that every item — the meta item included — propagates both
 * ways; an item whose base is never received stays pending in Yjs and is
 * never applied.
 */
function setup(): { doc: Y.Doc; peer: ReturnType<typeof createPeer>; undo: ReturnType<typeof createUndo> } {
  const doc = new Y.Doc();
  const peer = createPeer(doc);
  initDoc(doc);
  initDoc(peer.doc);
  const undo = createUndo(doc);
  return { doc, peer, undo };
}

/** Create a sticky with its top-left at (x, y). */
function stickyAt(doc: Y.Doc, x: number, y: number): string {
  const id = createSticky(doc, { x: x + 100, y: y + 100 });
  moveObjects(doc, new Map([[id, { x, y }]]));
  return id;
}

/** Set a sticky's text with a LOCAL_ORIGIN transaction (undoable). */
function setText(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id);
  if (ytext === undefined) throw new Error(`no text on ${id}`);
  doc.transact(() => ytext.insert(0, text), LOCAL_ORIGIN);
}

/** Plain comparison of the objects the tests care about. */
function plain(o: ObjectSnapshot): Record<string, unknown> {
  return {
    id: o.id,
    x: o.x,
    y: o.y,
    width: o.width ?? null,
    height: o.height ?? null,
    color: o.color ?? null,
    text: o.text ?? null,
    z: o.z,
  };
}

function plainMap(doc: Y.Doc): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const o of snapshot(doc)) out[o.id] = plain(o);
  return out;
}

describe('undo.history', () => {
  it('TC-01 undoing my move leaves a peer-created note and a peer colour change intact', () => {
    const { doc, undo, peer } = setup();

    const a = stickyAt(doc, 0, 0); // X: I move this
    undo.boundary();
    const c = stickyAt(doc, 600, 0); // Z: the peer recolours this
    undo.boundary();

    // Peer (remote origin): creates note Y, recolours note Z.
    peer.doc.transact(() => {
      const y = createSticky(peer.doc, { x: 400, y: 300 });
      moveObjects(peer.doc, new Map([[y, { x: 400, y: 300 }]]));
      setStickyColor(peer.doc, c, 'blue');
    });

    // I move X.
    moveObjects(doc, new Map([[a, { x: 50, y: 50 }]]));
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    const after = plainMap(doc);
    expect(after[a]).toEqual({ ...after[a], x: 0, y: 0 }); // X restored
    expect(after[c]?.color).toBe('blue'); // Z keeps the peer's colour
    // Y exists: find it by position (peer-created ids are unknown here).
    const peerNote = Object.values(after).find((o) => o.x === 400 && o.y === 300);
    expect(peerNote).toBeDefined();
    // My undo did not reverse the peer's changes.
    expect(Object.keys(after).length).toBe(3);
  });

  it('TC-02 peer-only changes are never captured: canUndo stays false', () => {
    const { undo, peer } = setup();

    const b = createSticky(peer.doc, { x: 100, y: 100 });
    peer.doc.transact(() => moveObjects(peer.doc, new Map([[b, { x: 200, y: 200 }]])));
    const c = createSticky(peer.doc, { x: 0, y: 0 });
    peer.doc.transact(() => setStickyColor(peer.doc, c, 'pink'));

    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-03 story 4 load updates (LOAD origin) are never captured', () => {
    const { doc, undo } = setup();

    applyLoad(doc, (loadDoc) => {
      createSticky(loadDoc, { x: 100, y: 100 });
      createSticky(loadDoc, { x: 300, y: 100 });
    });

    expect(snapshot(doc).length).toBe(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-04 deleting 8 notes is one step; undo restores text, colour, size and position', () => {
    const { doc, undo } = setup();

    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = stickyAt(doc, i * 300, (i % 2) * 100);
      ids.push(id);
      if (i % 2 === 0) setText(doc, id, `note ${i}`);
      if (i % 3 === 0) setStickyColor(doc, id, i % 2 === 0 ? 'blue' : 'pink');
      if (i === 2) resizeObjects(doc, new Map([[id, { x: i * 300, y: 100, width: 150, height: 150 }]]));
      undo.boundary(); // each setup action is its own step
    }
    undo.boundary();
    const before = plainMap(doc);

    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc).length).toBe(0);

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    const after = plainMap(doc);
    for (const id of ids) {
      expect(after[id]).toEqual(before[id]);
    }
    expect(Object.keys(after).length).toBe(8);
  });

  it('TC-05 undo then redo re-applies the change', () => {
    const { doc, undo } = setup();
    const a = stickyAt(doc, 0, 0);
    undo.boundary();

    moveObjects(doc, new Map([[a, { x: 77, y: -3 }]]));
    expect(undo.undo()).toBe(true);
    expect(plainMap(doc)[a]).toMatchObject({ x: 0, y: 0 });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(plainMap(doc)[a]).toMatchObject({ x: 77, y: -3 });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06 a new change after undoing clears the redo stack', () => {
    const { doc, undo } = setup();
    const a = stickyAt(doc, 0, 0);
    undo.boundary();

    moveObjects(doc, new Map([[a, { x: 10, y: 0 }]]));
    undo.boundary();
    setStickyColor(doc, a, 'green');
    undo.boundary();

    expect(undo.undo()).toBe(true); // undo the colour change
    expect(undo.canRedo()).toBe(true);
    setStickyColor(doc, a, 'violet'); // new local step
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(plainMap(doc)[a].color).toBe('violet');
  });

  it('TC-07 undoing a move of a remotely-deleted object: no throw, stays deleted, history usable', () => {
    const { doc, undo, peer } = setup();

    const a = stickyAt(doc, 0, 0);
    undo.boundary();
    const b = stickyAt(doc, 400, 0);
    undo.boundary();

    moveObjects(doc, new Map([[a, { x: 15, y: 15 }]])); // my step for a
    peer.doc.transact(() => deleteObjects(peer.doc, [a])); // peer deletes a

    // The move's inverse targets a deleted object: it applies nothing. Yjs
    // skips no-op steps inside one undo() call, so this single call
    // consumes the move AND reverts the previous effective step (b's
    // creation). No throw, a stays deleted.
    expect(() => undo.undo()).not.toThrow();
    expect(plainMap(doc)[a]).toBeUndefined(); // a stays deleted
    expect(plainMap(doc)[b]).toBeUndefined(); // b's creation was undone

    // The remaining step (a's creation) is a no-op now (a was deleted
    // remotely), so it is consumed without effect.
    expect(() => undo.undo()).not.toThrow();
    expect(undo.undo()).toBe(false);
    expect(plainMap(doc)[a]).toBeUndefined();
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-08 undoing my delete restores the note with its content at the time of my delete', () => {
    const { doc, undo, peer } = setup();

    const a = stickyAt(doc, 0, 0);
    setText(doc, a, 'mine');
    undo.boundary();

    // The peer edits the note before I delete it.
    peer.doc.transact(() => {
      const entry = peer.doc.getMap('objects').get(a);
      if (entry instanceof Y.Map) {
        const text = entry.get('text');
        if (text instanceof Y.Text) text.insert(0, 'peer-');
      }
    });
    expect(plainMap(doc)[a].text).toBe('peer-mine');

    expect(deleteObjects(doc, [a])).toBe(1);
    expect(undo.undo()).toBe(true);
    expect(plainMap(doc)[a]).toMatchObject({ text: 'peer-mine', x: 0, y: 0 });
  });

  it('TC-09 at UNDO_MAX_STEPS a new step drops the oldest (boundary)', () => {
    const { doc, undo } = setup();

    for (let i = 0; i < UNDO_MAX_STEPS + 1; i += 1) {
      createSticky(doc, { x: i * 100, y: 0 });
      undo.boundary();
    }
    expect(snapshot(doc).length).toBe(UNDO_MAX_STEPS + 1);

    let undone = 0;
    while (undo.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS); // the oldest step was trimmed
  });

  it('TC-10 at UNDO_MAX_STEPS − 1 a new step drops nothing (boundary)', () => {
    const { doc, undo } = setup();

    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) {
      createSticky(doc, { x: i * 100, y: 0 });
      undo.boundary();
    }

    let undone = 0;
    while (undo.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc).length).toBe(0);
  });

  it('TC-11 destroying the controller clears history: a fresh controller starts empty', () => {
    const { doc } = setup();
    const first = createUndo(doc);
    createSticky(doc, { x: 0, y: 0 });
    expect(first.canUndo()).toBe(true);

    first.destroy();
    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
    second.destroy();
  });

  it('onChange fires when steps are added, undone and redone', () => {
    const { doc, undo } = setup();
    let changes = 0;
    const stop = undo.onChange(() => {
      changes += 1;
    });

    const a = stickyAt(doc, 0, 0);
    expect(changes).toBeGreaterThan(0);
    moveObjects(doc, new Map([[a, { x: 5, y: 5 }]]));
    const afterStep = changes;
    expect(afterStep).toBeGreaterThan(changes - 1);

    undo.undo();
    expect(changes).toBeGreaterThan(afterStep);
    undo.redo();
    expect(changes).toBeGreaterThan(afterStep + 1);

    stop();
    const afterUnsubscribe = changes;
    createSticky(doc, { x: 1, y: 1 });
    expect(changes).toBe(afterUnsubscribe);
  });
});
