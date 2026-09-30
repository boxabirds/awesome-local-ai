import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { type UndoController, createUndo } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObjects,
  objectsMap,
  objectsSnapshot,
  resizeObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { connectPeer, loadInto } from './peer';

const controllers: UndoController[] = [];

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = createUndo(doc);
  controllers.push(undo);
  return { doc, undo };
}

afterEach(() => {
  for (const c of controllers.splice(0)) c.destroy();
});

function create(doc: Y.Doc, at = { x: 100, y: 100 }, color?: Parameters<typeof createSticky>[2]): string {
  const id = createSticky(doc, at, color);
  if (id === false) throw new Error('create rejected');
  return id;
}

/** One user action = one step: boundaries around it, as the app does. */
function step<T>(undo: UndoController, fn: () => T): T {
  undo.boundary();
  const result = fn();
  undo.boundary();
  return result;
}

function note(doc: Y.Doc, id: string) {
  return snapshot(doc).find((n) => n.id === id);
}

function undoDepth(undo: UndoController): number {
  let n = 0;
  while (undo.undo()) n++;
  return n;
}

describe('undo.history', () => {
  it('TC-01 undo reverses my move but none of the peer changes', () => {
    const { doc, undo } = setup();
    const { peer } = connectPeer(doc);
    const x = create(peer, { x: 100, y: 100 });
    const z = create(peer, { x: 500, y: 100 });
    step(undo, () => moveObjects(doc, new Map([[x, { x: 300, y: 300 }]])));
    const y = create(peer, { x: 900, y: 100 });
    setStickyColor(peer, z, 'pink');

    expect(undo.undo()).toBe(true);
    expect(note(doc, x)).toMatchObject({ x: 0, y: 0 });
    expect(note(doc, y)).toBeDefined();
    expect(note(doc, z)?.color).toBe('pink');
    expect(note(peer, x)).toMatchObject({ x: 0, y: 0 });
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-02 changes made only by the peer are never undoable', () => {
    const { doc, undo } = setup();
    const { peer } = connectPeer(doc);
    const id = create(peer);
    setStickyColor(peer, id, 'blue');
    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-03 updates applied with the load origin are never undoable', () => {
    const { doc, undo } = setup();
    const saved = new Y.Doc();
    initDoc(saved);
    create(saved);
    create(saved, { x: 400, y: 0 });
    loadInto(doc, saved);
    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04 undoing a delete of 8 notes restores text, colour, size and position', () => {
    const { doc, undo } = setup();
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'blue'] as const;
    const ids = colors.map((c, i) => create(doc, { x: i * 250, y: i * 30 }, c));
    ids.forEach((id, i) => doc.transact(() => getStickyText(doc, id)!.insert(0, `note ${i}`), LOCAL_ORIGIN));
    resizeObjects(doc, new Map([[ids[2]!, { x: 10, y: 20, width: 300, height: 300 }]]));
    const before = objectsSnapshot(doc);

    step(undo, () => deleteObjects(doc, ids));
    expect(snapshot(doc)).toHaveLength(0);
    undo.undo();
    expect(objectsSnapshot(doc)).toEqual(before);
    expect(note(doc, ids[2]!)).toMatchObject({ x: 10, y: 20, width: 300, height: 300, text: 'note 2', color: 'green' });
  });

  it('TC-05 undo then redo re-applies the move', () => {
    const { doc, undo } = setup();
    const id = step(undo, () => create(doc));
    step(undo, () => moveObjects(doc, new Map([[id, { x: 500, y: 600 }]])));
    undo.undo();
    expect(note(doc, id)).toMatchObject({ x: 0, y: 0 });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 500, y: 600 });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06 a new change after undoing clears redo', () => {
    const { doc, undo } = setup();
    const id = step(undo, () => create(doc));
    step(undo, () => setStickyColor(doc, id, 'green'));
    undo.undo();
    expect(note(doc, id)?.color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);
    step(undo, () => moveObjects(doc, new Map([[id, { x: 5, y: 5 }]])));
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-07 undoing a move of a note the peer deleted changes nothing and the next undo works', () => {
    const { doc, undo } = setup();
    const { peer } = connectPeer(doc);
    const other = step(undo, () => create(doc, { x: 1000, y: 0 }));
    const target = create(peer);
    step(undo, () => moveObjects(doc, new Map([[target, { x: 400, y: 400 }]])));
    deleteObjects(peer, [target]);

    expect(() => undo.undo()).not.toThrow();
    expect(note(doc, target)).toBeUndefined();
    expect(note(peer, target)).toBeUndefined();
    // The consumed step did not also undo the older step.
    expect(note(doc, other)).toBeDefined();
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(note(doc, other)).toBeUndefined();
    expect(objectsMap(doc).size).toBe(0);
  });

  it('TC-08 undoing my delete restores the content as it was when I deleted it', () => {
    const { doc, undo } = setup();
    const { peer } = connectPeer(doc);
    const id = create(peer);
    peer.transact(() => getStickyText(peer, id)!.insert(0, 'Raj was here'), LOCAL_ORIGIN);
    step(undo, () => deleteObjects(doc, [id]));
    undo.undo();
    expect(note(doc, id)?.text).toBe('Raj was here');
    expect(note(peer, id)?.text).toBe('Raj was here');
  });

  it('TC-09 with UNDO_MAX_STEPS steps, one more drops the oldest', () => {
    const { doc, undo } = setup();
    const ids = Array.from({ length: UNDO_MAX_STEPS + 1 }, (_, i) => step(undo, () => create(doc, { x: i * 10, y: 0 })));
    expect(undoDepth(undo)).toBe(UNDO_MAX_STEPS);
    // The oldest step (first note created) is gone, so that note remains.
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[0]]);
  });

  it('TC-10 with UNDO_MAX_STEPS − 1 steps, one more drops nothing', () => {
    const { doc, undo } = setup();
    for (let i = 0; i < UNDO_MAX_STEPS; i++) step(undo, () => create(doc, { x: i * 10, y: 0 }));
    expect(undoDepth(undo)).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a new controller after destroy (reload) has no history', () => {
    const { doc, undo } = setup();
    step(undo, () => create(doc));
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    const fresh = createUndo(doc);
    controllers.push(fresh);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('onChange fires when history changes and addScope tracks another type', () => {
    const { doc, undo } = setup();
    let calls = 0;
    const off = undo.onChange(() => calls++);
    step(undo, () => create(doc));
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    undo.undo();
    expect(calls).toBeGreaterThan(seen);
    off();
    const extra = doc.getMap('comments');
    undo.addScope(extra);
    undo.boundary();
    doc.transact(() => extra.set('c1', 'hello'), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(extra.has('c1')).toBe(false);
  });
});
