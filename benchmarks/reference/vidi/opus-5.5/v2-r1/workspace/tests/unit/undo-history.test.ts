// undo.history: the per-tab controller over real Y.Docs with a simulated remote peer (TC-01 to TC-11).
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  type StickySnapshot,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { type UndoController, createUndo } from '../../src/client/board/undo';
import { connectedPeers, loadInto } from './peer';

const controllers: UndoController[] = [];
function undoFor(doc: Y.Doc, opts?: Parameters<typeof createUndo>[1]) {
  const c = createUndo(doc, opts);
  controllers.push(c);
  return c;
}
afterEach(() => {
  for (const c of controllers.splice(0)) c.destroy();
});

function note(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

function typeInto(doc: Y.Doc, id: string, text: string) {
  doc.transact(() => getStickyText(doc, id)!.insert(0, text), LOCAL_ORIGIN);
}

describe('undo.history', () => {
  it('TC-01 undoes my move and leaves the peer’s creation and recolour alone', () => {
    const { local, remote } = connectedPeers();
    const x = createSticky(local, { x: 0, y: 0 }) as string;
    const z = createSticky(local, { x: 500, y: 0 }) as string;
    const undo = undoFor(local);
    const start = note(local, x)!;
    moveObjects(local, new Map([[x, { x: 300, y: 300 }]]));
    undo.boundary();
    const y = createSticky(remote, { x: 900, y: 900 }) as string;
    setStickyColor(remote, z, 'pink');

    expect(undo.undo()).toBe(true);
    expect(note(local, x)).toMatchObject({ x: start.x, y: start.y });
    expect(note(local, y)).toBeDefined();
    expect(note(local, z)!.color).toBe('pink');
    // The peer sees the same.
    expect(snapshot(remote)).toEqual(snapshot(local));
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-02 changes made only by the peer cannot be undone', () => {
    const { local, remote } = connectedPeers();
    const undo = undoFor(local);
    const id = createSticky(remote, { x: 0, y: 0 }) as string;
    moveObjects(remote, new Map([[id, { x: 10, y: 10 }]]));
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(note(local, id)).toBeDefined();
  });

  it('TC-03 content arriving with the load origin is not captured', () => {
    const saved = new Y.Doc();
    initDoc(saved);
    for (let i = 0; i < 3; i++) createSticky(saved, { x: i * 300, y: 0 });
    const local = new Y.Doc();
    const undo = undoFor(local);
    loadInto(local, saved);
    expect(snapshot(local)).toHaveLength(3);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04 undoing a delete of 8 notes restores text, colour, size and position', () => {
    const { local, remote } = connectedPeers();
    const ids: string[] = [];
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'green', 'blue'];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(local, { x: i * 250, y: 100 }) as string;
      setStickyColor(local, id, colors[i]);
      typeInto(local, id, `note ${i}`);
      resizeObjects(local, new Map([[id, { x: i * 250, y: 100, width: 150 + i * 10, height: 180 }]]));
      ids.push(id);
    }
    const undo = undoFor(local);
    const before = snapshot(local);
    deleteObjects(local, ids);
    expect(snapshot(local)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(local)).toEqual(before);
    expect(snapshot(remote)).toEqual(before);
  });

  it('TC-05 undo then redo re-applies a move', () => {
    const { local } = connectedPeers();
    const id = createSticky(local, { x: 100, y: 100 }) as string;
    const undo = undoFor(local);
    moveObjects(local, new Map([[id, { x: 400, y: 50 }]]));
    undo.undo();
    expect(note(local, id)).toMatchObject({ x: 0, y: 0 });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(local, id)).toMatchObject({ x: 400, y: 50 });
    expect(undo.canRedo()).toBe(false);
    expect(undo.canUndo()).toBe(true);
  });

  it('TC-06 a new change after undo clears redo', () => {
    const { local } = connectedPeers();
    const id = createSticky(local, { x: 0, y: 0 }) as string;
    const undo = undoFor(local);
    setStickyColor(local, id, 'blue');
    undo.undo();
    expect(note(local, id)!.color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);
    setStickyColor(local, id, 'green');
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(note(local, id)!.color).toBe('green');
  });

  it('TC-07 undoing a move of a note the peer deleted does nothing and keeps history usable', () => {
    const { local, remote } = connectedPeers();
    const a = createSticky(local, { x: 0, y: 0 }) as string;
    const b = createSticky(local, { x: 1000, y: 0 }) as string;
    const undo = undoFor(local);
    moveObjects(local, new Map([[b, { x: 1200, y: 300 }]]));
    undo.boundary();
    moveObjects(local, new Map([[a, { x: 500, y: 500 }]]));
    undo.boundary();
    deleteObjects(remote, [a]);

    expect(() => undo.undo()).not.toThrow();
    expect(note(local, a)).toBeUndefined();
    expect(note(remote, a)).toBeUndefined();
    // Only that one step was consumed: b has not moved back yet.
    expect(note(local, b)).toMatchObject({ x: 1200, y: 300 });
    expect(undo.undo()).toBe(true);
    expect(note(local, b)).toMatchObject({ x: 900, y: -100 });
    expect(note(local, a)).toBeUndefined();
  });

  it('TC-08 undoing my delete restores the note with its content at the time of my delete', () => {
    const { local, remote } = connectedPeers();
    const id = createSticky(local, { x: 0, y: 0 }) as string;
    const undo = undoFor(local);
    remote.transact(() => getStickyText(remote, id)!.insert(0, 'Raj was typing'));
    deleteObjects(local, [id]);
    undo.undo();
    expect(note(local, id)!.text).toBe('Raj was typing');
    expect(note(remote, id)!.text).toBe('Raj was typing');
  });

  it(`TC-09 at UNDO_MAX_STEPS a new step drops the oldest`, () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = undoFor(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: i, y: 0 }) as string);
      undo.boundary();
    }
    let steps = 0;
    while (undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    // The oldest creation can no longer be undone.
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[0]]);
  });

  it(`TC-10 at UNDO_MAX_STEPS − 1 a new step drops nothing`, () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = undoFor(doc);
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i, y: 0 });
      undo.boundary();
    }
    let steps = 0;
    while (undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a new controller after destroy (reload) starts empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const first = undoFor(doc);
    createSticky(doc, { x: 0, y: 0 });
    expect(first.canUndo()).toBe(true);
    const changes: number[] = [];
    first.onChange(() => changes.push(1));
    first.destroy();
    expect(first.canUndo()).toBe(false);
    expect(first.undo()).toBe(false);
    const second = undoFor(doc);
    expect(second.canUndo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('onChange fires on new steps, undo and redo; addScope extends the history', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = undoFor(doc);
    let calls = 0;
    const off = undo.onChange(() => calls++);
    createSticky(doc, { x: 0, y: 0 });
    expect(calls).toBeGreaterThan(0);
    const afterAdd = calls;
    undo.undo();
    expect(calls).toBeGreaterThan(afterAdd);
    off();
    const afterOff = calls;
    undo.redo();
    expect(calls).toBe(afterOff);

    const comments = doc.getMap<string>('comments');
    undo.addScope(comments as unknown as Y.AbstractType<unknown>);
    undo.boundary();
    doc.transact(() => comments.set('c1', 'hello'), LOCAL_ORIGIN);
    undo.undo();
    expect(comments.has('c1')).toBe(false);
  });
});
