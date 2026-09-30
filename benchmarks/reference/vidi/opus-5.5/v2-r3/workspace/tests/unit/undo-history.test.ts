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
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { connectedPeers, loadInto } from './peer';

const HALF = STICKY_SIZE_WORLD / 2;
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const controllers: UndoController[] = [];
function undoFor(doc: Y.Doc, opts?: Parameters<typeof createUndo>[1]): UndoController {
  const c = createUndo(doc, opts);
  controllers.push(c);
  return c;
}
afterEach(() => {
  for (const c of controllers.splice(0)) c.destroy();
});

/** One user action: a single model call between two boundaries (as the UI does). */
function step<T>(undo: UndoController, fn: () => T): T {
  undo.boundary();
  const result = fn();
  undo.boundary();
  return result;
}

function note(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

function noteAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x: x + HALF, y: y + HALF });
}

function typeInto(doc: Y.Doc, id: string, text: string) {
  const ytext = getStickyText(doc, id)!;
  doc.transact(() => ytext.insert(ytext.length, text), LOCAL_ORIGIN);
}

describe('undo.history', () => {
  it('TC-01 undoes my move but never the peer’s create or recolour', () => {
    const { local, remote } = connectedPeers();
    const x = noteAt(local, 0, 0);
    const z = noteAt(local, 400, 0);
    const undo = undoFor(local);

    step(undo, () => moveObjects(local, new Map([[x, { x: 100, y: 50 }]])));
    const y = noteAt(remote, 800, 0);
    setStickyColor(remote, z, 'pink');
    expect(note(local, y)).toBeDefined();
    expect(note(local, z)!.color).toBe('pink');

    expect(undo.undo()).toBe(true);
    expect(note(local, x)).toMatchObject({ x: 0, y: 0 });
    expect(note(local, y)).toBeDefined();
    expect(note(local, z)!.color).toBe('pink');
    // The undo syncs like any change.
    expect(note(remote, x)).toMatchObject({ x: 0, y: 0 });
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-02 changes from other people are not captured', () => {
    const { local, remote } = connectedPeers();
    const undo = undoFor(local);
    const id = noteAt(remote, 0, 0);
    setStickyColor(remote, id, 'blue');
    moveObjects(remote, new Map([[id, { x: 5, y: 5 }]]));
    expect(note(local, id)).toBeDefined();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(note(local, id)).toBeDefined();
  });

  it('TC-03 the loaded board state is not captured', () => {
    const saved = new Y.Doc();
    initDoc(saved);
    noteAt(saved, 0, 0);
    noteAt(saved, 300, 0);
    const doc = new Y.Doc();
    const undo = undoFor(doc);
    loadInto(doc, saved);
    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('TC-04 undoing a delete of 8 notes restores text, colour, size and position', () => {
    const { local, remote } = connectedPeers();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = noteAt(local, i * 250, (i % 3) * 250);
      setStickyColor(local, id, COLORS[i % COLORS.length]);
      typeInto(local, id, `idea ${i}`);
      resizeObjects(local, new Map([[id, { x: i * 250, y: (i % 3) * 250, width: 100 + i * 20, height: 120 + i * 10 }]]));
      ids.push(id);
    }
    const before = snapshot(local);
    const undo = undoFor(local);

    step(undo, () => deleteObjects(local, ids));
    expect(snapshot(local)).toHaveLength(0);
    expect(undo.undo()).toBe(true);
    expect(snapshot(local)).toEqual(before);
    expect(snapshot(remote)).toEqual(before);
    for (const [i, id] of ids.entries()) expect(getStickyText(local, id)!.toString()).toBe(`idea ${i}`);
  });

  it('TC-05 redo re-applies an undone move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = noteAt(doc, 0, 0);
    const undo = undoFor(doc);
    step(undo, () => moveObjects(doc, new Map([[id, { x: 300, y: 40 }]])));
    undo.undo();
    expect(note(doc, id)).toMatchObject({ x: 0, y: 0 });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 300, y: 40 });
    expect(undo.canRedo()).toBe(false);
    expect(undo.canUndo()).toBe(true);
  });

  it('TC-06 a new change after undoing clears redo', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = noteAt(doc, 0, 0);
    const undo = undoFor(doc);
    step(undo, () => setStickyColor(doc, id, 'green'));
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    step(undo, () => setStickyColor(doc, id, 'violet'));
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(note(doc, id)!.color).toBe('violet');
  });

  it('TC-07 undoing a move of a note someone else deleted does nothing and keeps history usable', () => {
    const { local, remote } = connectedPeers();
    const a = noteAt(local, 0, 0);
    const b = noteAt(local, 400, 0);
    const undo = undoFor(local);
    step(undo, () => moveObjects(local, new Map([[b, { x: 500, y: 100 }]])));
    step(undo, () => moveObjects(local, new Map([[a, { x: 50, y: 50 }]])));
    deleteObjects(remote, [a]);
    expect(note(local, a)).toBeUndefined();

    expect(() => undo.undo()).not.toThrow();
    expect(note(local, a)).toBeUndefined();
    expect(note(remote, a)).toBeUndefined();
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(note(local, b)).toMatchObject({ x: 400, y: 0 });
    expect(note(remote, b)).toMatchObject({ x: 400, y: 0 });
  });

  it('TC-08 undoing my delete restores the content as it was when I deleted it', () => {
    const { local, remote } = connectedPeers();
    const id = noteAt(local, 0, 0);
    typeInto(local, id, 'mine');
    const undo = undoFor(local);
    const remoteText = getStickyText(remote, id)!;
    remote.transact(() => remoteText.insert(remoteText.length, ' + raj'));
    expect(getStickyText(local, id)!.toString()).toBe('mine + raj');

    step(undo, () => deleteObjects(local, [id]));
    undo.undo();
    expect(getStickyText(local, id)!.toString()).toBe('mine + raj');
    expect(getStickyText(remote, id)!.toString()).toBe('mine + raj');
  });

  it('TC-09 at UNDO_MAX_STEPS a new step drops the oldest', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = undoFor(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) ids.push(step(undo, () => noteAt(doc, i * 10, 0)));
    step(undo, () => noteAt(doc, -500, 0));
    let count = 0;
    while (undo.undo()) count++;
    expect(count).toBe(UNDO_MAX_STEPS);
    // The oldest creation is no longer undoable.
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[0]]);
  });

  it('TC-10 at UNDO_MAX_STEPS − 1 a new step drops nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = undoFor(doc);
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) step(undo, () => noteAt(doc, i * 10, 0));
    step(undo, () => noteAt(doc, -500, 0));
    let count = 0;
    while (undo.undo()) count++;
    expect(count).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a new controller (after reload) starts with empty history', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const first = undoFor(doc);
    step(first, () => noteAt(doc, 0, 0));
    expect(first.canUndo()).toBe(true);
    first.destroy();
    expect(first.canUndo()).toBe(false);
    expect(first.undo()).toBe(false);
    const second = undoFor(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('onChange reports stack changes; addScope brings another type into the history', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = undoFor(doc);
    let calls = 0;
    const off = undo.onChange(() => calls++);
    step(undo, () => noteAt(doc, 0, 0));
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    undo.undo();
    expect(calls).toBeGreaterThan(seen);
    off();
    const after = calls;
    undo.redo();
    expect(calls).toBe(after);

    const comments = doc.getMap('comments');
    undo.addScope(comments);
    step(undo, () => doc.transact(() => comments.set('c1', 'hi'), LOCAL_ORIGIN));
    undo.undo();
    expect(comments.has('c1')).toBe(false);
  });
});
