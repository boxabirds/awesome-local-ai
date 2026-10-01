import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import {
  createSticky, deleteObjects, getStickyText, moveObjects, setStickyColor, snapshotObjects, type StickySnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { applyAsLoad, connectPeer, newBoardDoc } from './helpers/peer';

const byId = (doc: Y.Doc, id: string) => snapshotObjects(doc).find((o) => o.id === id) as StickySnapshot | undefined;
const move = (doc: Y.Doc, id: string, x: number, y: number) => moveObjects(doc, new Map([[id, { x, y }]]));

function setup() {
  const doc = newBoardDoc();
  const peer = connectPeer(doc);
  const undo = createUndo(doc);
  return { doc, peer, undo };
}

describe('undo history', () => {
  it('TC-01 undo reverses my move only; the peer\'s creation and recolour stay', () => {
    const { doc, peer, undo } = setup();
    const x2 = createSticky(doc, { x: 0, y: 0 }) as string;
    const z2 = createSticky(doc, { x: 500, y: 0 }) as string;
    undo.boundary();
    const before = byId(doc, x2)!;
    move(doc, x2, 900, 900);
    undo.boundary();
    const y = createSticky(peer, { x: 10, y: 10 }) as string;
    setStickyColor(peer, z2, 'pink');
    expect(undo.undo()).toBe(true);
    expect(byId(doc, x2)!.x).toBe(before.x);
    expect(byId(doc, x2)!.y).toBe(before.y);
    expect(byId(doc, y)).toBeDefined();
    expect(byId(doc, z2)!.color).toBe('pink');
  });

  it('TC-02 changes made only by the peer leave nothing to undo', () => {
    const { peer, undo } = setup();
    createSticky(peer, { x: 0, y: 0 });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-03 updates applied with the load origin are not captured', () => {
    const doc = newBoardDoc();
    const undo = createUndo(doc);
    const saved = newBoardDoc();
    createSticky(saved, { x: 1, y: 1 });
    applyAsLoad(doc, saved);
    expect(snapshotObjects(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04 undoing a delete of 8 notes restores text, colour, size and position', () => {
    const { doc, undo } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: i * 50, y: i * 20 }, i % 2 ? 'blue' : 'green') as string;
      getStickyText(doc, id)!.insert(0, `note ${i}`);
      ids.push(id);
    }
    undo.boundary();
    const before = snapshotObjects(doc);
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshotObjects(doc)).toHaveLength(0);
    expect(undo.undo()).toBe(true);
    expect(snapshotObjects(doc)).toEqual(before);
  });

  it('TC-05 redo re-applies an undone move', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    undo.boundary();
    move(doc, id, 300, 400);
    undo.boundary();
    undo.undo();
    expect(byId(doc, id)!.x).toBe(-100);
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(byId(doc, id)!.x).toBe(300);
    expect(byId(doc, id)!.y).toBe(400);
  });

  it('TC-06 a new change after undo clears redo', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    undo.boundary();
    setStickyColor(doc, id, 'pink');
    undo.boundary();
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    setStickyColor(doc, id, 'blue');
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07 undoing a move of an object the peer deleted does nothing and keeps history usable', () => {
    const { doc, peer, undo } = setup();
    const a = createSticky(doc, { x: 0, y: 0 }) as string;
    undo.boundary();
    const b = createSticky(doc, { x: 300, y: 0 }) as string;
    undo.boundary();
    move(doc, b, 700, 700);
    undo.boundary();
    deleteObjects(peer, [b]);
    expect(() => undo.undo()).not.toThrow();
    expect(byId(doc, b)).toBeUndefined();
    expect(undo.undo()).toBe(true); // creation of b: nothing to remove, step consumed
    expect(byId(doc, a)).toBeDefined();
    expect(undo.undo()).toBe(true); // creation of a
    expect(byId(doc, a)).toBeUndefined();
  });

  it('TC-08 undoing my delete restores the content as it was when I deleted it', () => {
    const { doc, peer, undo } = setup();
    const id = createSticky(peer, { x: 0, y: 0 }) as string;
    getStickyText(peer, id)!.insert(0, 'first');
    getStickyText(peer, id)!.insert(5, ' second');
    deleteObjects(doc, [id]);
    undo.boundary();
    expect(byId(doc, id)).toBeUndefined();
    undo.undo();
    expect(byId(doc, id)!.text).toBe('first second');
  });

  it('TC-09 at UNDO_MAX_STEPS a new step drops the oldest', () => {
    const doc = newBoardDoc();
    const undo = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: i, y: 0 }) as string);
      undo.boundary();
    }
    let steps = 0;
    while (undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(byId(doc, ids[0])).toBeDefined(); // oldest creation can no longer be undone
    expect(byId(doc, ids[1])).toBeUndefined();
  });

  it('TC-10 one below the limit plus one step drops nothing', () => {
    const doc = newBoardDoc();
    const undo = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      ids.push(createSticky(doc, { x: i, y: 0 }) as string);
      undo.boundary();
    }
    let steps = 0;
    while (undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-11 a new controller after destroy (reload) starts empty', () => {
    const doc = newBoardDoc();
    const first = createUndo(doc);
    createSticky(doc, { x: 0, y: 0 });
    expect(first.canUndo()).toBe(true);
    first.destroy();
    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.canRedo()).toBe(false);
  });

  it('notifies onChange listeners and stops after unsubscribe', () => {
    const doc = newBoardDoc();
    const undo = createUndo(doc);
    let calls = 0;
    const off = undo.onChange(() => { calls++; });
    createSticky(doc, { x: 0, y: 0 });
    expect(calls).toBeGreaterThan(0);
    off();
    const seen = calls;
    undo.boundary();
    undo.undo();
    expect(calls).toBe(seen);
  });
});
