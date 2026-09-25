import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  resizeObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { connectedPeer, loadInto } from './peer';

const controllers: UndoController[] = [];
afterEach(() => {
  controllers.splice(0).forEach((c) => c.destroy());
});

function undoFor(doc: Y.Doc, opts?: Parameters<typeof createUndo>[1]) {
  const c = createUndo(doc, opts);
  controllers.push(c);
  return c;
}

/** Runs one local change as its own step. */
function step<T>(c: UndoController, change: () => T): T {
  c.boundary();
  const r = change();
  c.boundary();
  return r;
}

function note(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

/** Undoes until the stack is empty; returns how many steps there were. */
function drainUndo(c: UndoController): number {
  let n = 0;
  while (c.undo()) n++;
  return n;
}

describe('per-user undo history (undo.history)', () => {
  it('TC-01 undo reverses my move and leaves the peer’s create and recolour intact', () => {
    const { local, peer } = connectedPeer();
    const x = createSticky(local, { x: 0, y: 0 });
    const z = createSticky(local, { x: 500, y: 0 });
    const c = undoFor(local);
    const before = note(local, x)!;
    step(c, () => moveObject(local, x, 1000, 1000));
    const y = createSticky(peer, { x: 300, y: 300 });
    setStickyColor(peer, z, 'pink');
    expect(c.undo()).toBe(true);
    expect(note(local, x)).toMatchObject({ x: before.x, y: before.y });
    expect(note(local, y)).toBeDefined();
    expect(note(local, z)!.color).toBe('pink');
    // All screens identical.
    expect(snapshot(peer)).toEqual(snapshot(local));
    expect(c.canUndo()).toBe(false);
  });

  it('TC-02 changes made only by others are never captured', () => {
    const { local, peer } = connectedPeer();
    const c = undoFor(local);
    const id = createSticky(peer, { x: 0, y: 0 });
    setStickyColor(peer, id, 'blue');
    expect(note(local, id)).toBeDefined();
    expect(c.canUndo()).toBe(false);
    expect(c.undo()).toBe(false);
    expect(note(local, id)!.color).toBe('blue');
  });

  it('TC-03 a saved board loading (LOAD origin) is never captured', () => {
    const saved = new Y.Doc();
    initDoc(saved);
    createSticky(saved, { x: 0, y: 0 });
    createSticky(saved, { x: 300, y: 0 });
    const doc = new Y.Doc();
    const c = undoFor(doc);
    loadInto(doc, saved);
    expect(snapshot(doc)).toHaveLength(2);
    expect(c.canUndo()).toBe(false);
    expect(c.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('TC-04 undoing a delete of 8 notes restores all 8 with text, colour, size and position', () => {
    const { local, peer } = connectedPeer();
    const colours = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'green'] as const;
    const ids = colours.map((col, i) => {
      const id = createSticky(local, { x: i * 250, y: i * 10 }, col);
      getStickyText(local, id)!.insert(0, `Idea ${i + 1}`);
      return id;
    });
    resizeObjects(local, new Map([[ids[2], { x: 10, y: 20, width: 320, height: 320 }]]));
    const c = undoFor(local);
    const before = snapshot(local);
    step(c, () => deleteObjects(local, ids));
    expect(snapshot(local)).toHaveLength(0);
    expect(c.undo()).toBe(true);
    expect(snapshot(local)).toEqual(before);
    expect(snapshot(peer)).toEqual(before);
  });

  it('TC-05 redo re-applies an undone move', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const c = undoFor(doc);
    step(c, () => moveObject(doc, id, 700, 800));
    expect(c.canRedo()).toBe(false);
    c.undo();
    expect(note(doc, id)).toMatchObject({ x: 0, y: 0 });
    expect(c.canRedo()).toBe(true);
    expect(c.redo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 700, y: 800 });
    expect(c.canRedo()).toBe(false);
    expect(c.redo()).toBe(false);
    // Undo again after redo.
    expect(c.undo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-06 a new change after undoing clears redo', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 100, y: 100 });
    const c = undoFor(doc);
    step(c, () => setStickyColor(doc, id, 'green'));
    c.undo();
    expect(c.canRedo()).toBe(true);
    step(c, () => setStickyColor(doc, id, 'blue'));
    expect(c.canRedo()).toBe(false);
    expect(c.redo()).toBe(false);
    expect(note(doc, id)!.color).toBe('blue');
  });

  it('TC-07 undoing a move of a note the peer deleted does nothing, and the next undo still works', () => {
    const { local, peer } = connectedPeer();
    const x = createSticky(local, { x: 100, y: 100 });
    const w = createSticky(local, { x: 600, y: 100 });
    const c = undoFor(local);
    step(c, () => moveObject(local, w, 900, 900));
    step(c, () => moveObject(local, x, 400, 400));
    deleteObjects(peer, [x]);
    expect(note(local, x)).toBeUndefined();
    expect(() => c.undo()).not.toThrow();
    expect(note(local, x)).toBeUndefined(); // not recreated
    expect(note(peer, x)).toBeUndefined();
    // That step is consumed on its own: the earlier move is untouched until the next undo.
    expect(note(local, w)).toMatchObject({ x: 900, y: 900 });
    expect(c.canUndo()).toBe(true);
    expect(c.undo()).toBe(true);
    expect(note(local, w)).toMatchObject({ x: 500, y: 0 });
    expect(snapshot(peer)).toEqual(snapshot(local));
  });

  it('TC-08 undoing my delete restores the note with its content at the time of my delete', () => {
    const { local, peer } = connectedPeer();
    const id = createSticky(local, { x: 100, y: 100 });
    getStickyText(local, id)!.insert(0, 'Mine');
    const c = undoFor(local);
    getStickyText(peer, id)!.insert(4, ' and Raj’s');
    setStickyColor(peer, id, 'violet');
    step(c, () => deleteObjects(local, [id]));
    c.undo();
    expect(note(local, id)).toMatchObject({ text: 'Mine and Raj’s', color: 'violet' });
    expect(note(peer, id)).toMatchObject({ text: 'Mine and Raj’s', color: 'violet' });
  });

  it('TC-09 at UNDO_MAX_STEPS, a new step drops the oldest', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = undoFor(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) ids.push(step(c, () => createSticky(doc, { x: i, y: 0 })));
    expect(drainUndo(c)).toBe(UNDO_MAX_STEPS);
    // The oldest creation can no longer be undone; every later one was.
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[0]]);
  });

  it('TC-10 at UNDO_MAX_STEPS − 1, a new step drops nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = undoFor(doc);
    for (let i = 0; i < UNDO_MAX_STEPS; i++) step(c, () => createSticky(doc, { x: i, y: 0 }));
    expect(drainUndo(c)).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a new controller (page reload) starts with no history', () => {
    const doc = new Y.Doc();
    const c = undoFor(doc);
    step(c, () => createSticky(doc, { x: 0, y: 0 }));
    expect(c.canUndo()).toBe(true);
    c.destroy();
    const fresh = undoFor(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('onChange reports stack changes; addScope brings another shared type under the same history', () => {
    const doc = new Y.Doc();
    const c = undoFor(doc);
    let calls = 0;
    const off = c.onChange(() => calls++);
    step(c, () => createSticky(doc, { x: 0, y: 0 }));
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    c.undo();
    expect(calls).toBeGreaterThan(seen);
    off();
    const after = calls;
    c.redo();
    expect(calls).toBe(after);

    const comments = doc.getMap('comments');
    c.addScope(comments);
    c.boundary();
    doc.transact(() => comments.set('c1', 'hello'), LOCAL_ORIGIN);
    c.boundary();
    doc.transact(() => comments.set('c2', 'from a peer'), Symbol('peer'));
    expect(c.undo()).toBe(true);
    // Only my comment is undone, also in the added scope.
    expect(comments.toJSON()).toEqual({ c2: 'from a peer' });
  });
});
