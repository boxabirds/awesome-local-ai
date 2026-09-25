import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyLoaded, connectPeer, type Peer } from './peer';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

function note(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

function setText(doc: Y.Doc, id: string, text: string, origin: unknown = LOCAL_ORIGIN): void {
  const ytext = getStickyText(doc, id)!;
  doc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, text);
  }, origin);
}

describe('createUndo (undo.history)', () => {
  let doc: Y.Doc;
  let peer: Peer;
  let undo: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    peer = connectPeer(doc);
    undo = createUndo(doc);
  });
  afterEach(() => {
    undo.destroy();
    peer.disconnect();
  });

  /** A note created by the peer (not in my history). */
  function peerNote(at = { x: 0, y: 0 }): string {
    return createSticky(peer.doc, at);
  }

  it('TC-01 undoes my move but none of the peer changes made since', () => {
    const x = peerNote({ x: 100, y: 100 });
    const z = peerNote({ x: 500, y: 500 });
    const before = note(doc, x)!;
    moveObject(doc, x, 900, 900);
    undo.boundary();
    const y = peerNote({ x: -300, y: -300 });
    setStickyColor(peer.doc, z, 'pink');

    expect(undo.undo()).toBe(true);
    expect(note(doc, x)).toMatchObject({ x: before.x, y: before.y });
    expect(note(doc, y)).toBeDefined();
    expect(note(doc, z)!.color).toBe('pink');
    // Both screens agree.
    expect(snapshot(peer.doc)).toEqual(snapshot(doc));
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-02 changes made only by the peer are not undoable', () => {
    const id = peerNote();
    setStickyColor(peer.doc, id, 'blue');
    expect(note(doc, id)).toBeDefined();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(note(doc, id)!.color).toBe('blue');
  });

  it('TC-03 updates applied with the LOAD origin are not undoable', () => {
    const saved = new Y.Doc();
    createSticky(saved, { x: 1, y: 2 });
    createSticky(saved, { x: 3, y: 4 });
    const fresh = new Y.Doc();
    const u = createUndo(fresh);
    applyLoaded(fresh, saved);
    expect(snapshot(fresh)).toHaveLength(2);
    expect(u.canUndo()).toBe(false);
    expect(u.undo()).toBe(false);
    u.destroy();
  });

  it('TC-04 one undo restores 8 deleted notes with text, colour, size and position', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 250, y: i * 30 }, COLORS[i % COLORS.length]!);
      setText(doc, id, `idea ${i}`);
      resizeObjects(doc, new Map([[id, { x: i * 250, y: i * 30, width: 150 + i * 10, height: 120 + i * 5 }]]));
      ids.push(id);
    }
    undo.boundary();
    const before = snapshot(doc);
    expect(deleteObjects(doc, ids)).toBe(8);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      expect(after.find((n) => n.id === b.id)).toMatchObject({
        text: b.text,
        color: b.color,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      });
    }
    expect(snapshot(peer.doc)).toEqual(after);
  });

  it('TC-05 undo then redo re-applies the move', () => {
    const id = peerNote({ x: 0, y: 0 });
    const start = note(doc, id)!;
    moveObject(doc, id, 400, 300);
    undo.boundary();
    undo.undo();
    expect(note(doc, id)).toMatchObject({ x: start.x, y: start.y });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 400, y: 300 });
    expect(note(peer.doc, id)).toMatchObject({ x: 400, y: 300 });
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-06 a new change after undoing clears redo', () => {
    const id = peerNote();
    setStickyColor(doc, id, 'green');
    undo.boundary();
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    setStickyColor(doc, id, 'blue');
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(note(doc, id)!.color).toBe('blue');
  });

  it('TC-07 undoing a move of a note the peer deleted has no effect and history stays usable', () => {
    const kept = peerNote({ x: 0, y: 0 });
    const gone = peerNote({ x: 1000, y: 0 });
    moveObject(doc, kept, 50, 50);
    undo.boundary();
    moveObject(doc, gone, 1200, 200);
    undo.boundary();
    deleteObjects(peer.doc, [gone]);

    expect(() => undo.undo()).not.toThrow();
    expect(note(doc, gone)).toBeUndefined();
    expect(note(peer.doc, gone)).toBeUndefined();
    // The step was consumed: the earlier move is untouched by that undo.
    expect(note(doc, kept)).toMatchObject({ x: 50, y: 50 });
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    expect(note(doc, kept)).toMatchObject({ x: -100, y: -100 });
    expect(note(doc, gone)).toBeUndefined();
  });

  it('TC-08 undoing my delete restores the note with its content at the time of the delete', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    setText(doc, id, 'mine');
    undo.boundary();
    setText(peer.doc, id, 'edited by peer');
    setStickyColor(peer.doc, id, 'orange');
    deleteObjects(doc, [id]);
    undo.boundary();

    undo.undo();
    expect(note(doc, id)).toMatchObject({ text: 'edited by peer', color: 'orange' });
    expect(note(peer.doc, id)).toMatchObject({ text: 'edited by peer', color: 'orange' });
  });

  function steps(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(createSticky(doc, { x: i, y: 0 }));
      undo.boundary();
    }
    return ids;
  }

  it('TC-09 at UNDO_MAX_STEPS a new step drops the oldest', () => {
    const ids = steps(UNDO_MAX_STEPS);
    expect(undo.undoSize()).toBe(UNDO_MAX_STEPS);
    ids.push(createSticky(doc, { x: -1, y: -1 }));
    expect(undo.undoSize()).toBe(UNDO_MAX_STEPS);
    while (undo.undo());
    // Every creation but the oldest was undone.
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[0]]);
  });

  it('TC-10 at UNDO_MAX_STEPS − 1 a new step drops nothing', () => {
    const ids = steps(UNDO_MAX_STEPS - 1);
    createSticky(doc, { x: -1, y: -1 });
    expect(undo.undoSize()).toBe(UNDO_MAX_STEPS);
    while (undo.undo());
    expect(snapshot(doc)).toHaveLength(0);
    expect(ids).toHaveLength(UNDO_MAX_STEPS - 1);
  });

  it('TC-11 a new controller (reload) starts with an empty history', () => {
    createSticky(doc, { x: 0, y: 0 });
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
    expect(undo.canUndo()).toBe(false);
    undo = createUndo(doc);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('onChange reports stack changes; addScope tracks another shared type', () => {
    let calls = 0;
    const off = undo.onChange(() => (calls += 1));
    createSticky(doc, { x: 0, y: 0 });
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    undo.undo();
    expect(calls).toBeGreaterThan(seen);
    off();
    const comments = doc.getMap('comments');
    undo.addScope(comments);
    undo.boundary();
    doc.transact(() => comments.set('c1', 'hi'), LOCAL_ORIGIN);
    expect(undo.undo()).toBe(true);
    expect(comments.has('c1')).toBe(false);
  });
});
