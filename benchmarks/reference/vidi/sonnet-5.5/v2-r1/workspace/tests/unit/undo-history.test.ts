import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObjects,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { applyAsLoad, connectPeer } from './peer';

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = createUndo(doc);
  const peer = connectPeer(doc);
  return { doc, undo, peer };
}
const get = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id);
const step = (undo: ReturnType<typeof createUndo>) => undo.boundary();

describe('undo.history', () => {
  it('TC-01 undo reverses only my change, not the peer’s', () => {
    const { doc, undo, peer } = setup();
    const x = createSticky(doc, { x: 100, y: 100 }) as string;
    const z = createSticky(doc, { x: 500, y: 500 }) as string;
    step(undo);
    const before = get(doc, x)!;
    moveObjects(doc, new Map([[x, { x: 900, y: 900 }]]));
    step(undo);
    // The peer's own transactions use LOCAL_ORIGIN on the peer doc but reach `doc` as remote updates.
    const y = createSticky(peer, { x: 0, y: 0 }) as string;
    setStickyColor(peer, z, 'pink');
    expect(undo.undo()).toBe(true);
    expect(get(doc, x)!.x).toBe(before.x);
    expect(get(doc, y)).toBeTruthy();
    expect(get(doc, z)!.color).toBe('pink');
  });

  it('TC-02 peer changes only: nothing to undo', () => {
    const { undo, peer } = setup();
    createSticky(peer, { x: 1, y: 1 });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-03 load-origin updates are not captured', () => {
    const { doc, undo } = setup();
    const other = new Y.Doc();
    initDoc(other);
    createSticky(other, { x: 1, y: 1 });
    applyAsLoad(doc, other);
    expect(snapshot(doc)).toHaveLength(1);
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
    step(undo);
    const before = snapshot(doc);
    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);
    step(undo);
    undo.undo();
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const o of before) expect(after.find((a) => a.id === o.id)).toEqual(o);
  });

  it('TC-05 undo then redo re-applies the move', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    step(undo);
    const start = get(doc, id)!.x;
    moveObjects(doc, new Map([[id, { x: 700, y: 700 }]]));
    undo.undo();
    expect(get(doc, id)!.x).toBe(start);
    expect(undo.canRedo()).toBe(true);
    undo.redo();
    expect(get(doc, id)!.x).toBe(700);
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06 a new change after undo clears redo', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    step(undo);
    setStickyColor(doc, id, 'pink');
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    step(undo);
    setStickyColor(doc, id, 'blue');
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07 undoing a move of an object the peer deleted is a no-op that keeps history usable', () => {
    const { doc, undo, peer } = setup();
    const keep = createSticky(doc, { x: 0, y: 0 }) as string;
    const gone = createSticky(doc, { x: 10, y: 10 }) as string;
    step(undo);
    setStickyColor(doc, keep, 'pink');
    step(undo);
    moveObjects(doc, new Map([[gone, { x: 500, y: 500 }]]));
    deleteObjects(peer, [gone]);
    // Yjs skips the step whose target is gone and goes on to the next one in the same call.
    expect(() => undo.undo()).not.toThrow();
    expect(get(doc, gone)).toBeUndefined();
    expect(get(doc, keep)!.color).toBe('yellow');
    expect(undo.undo()).toBe(true);
    expect(get(doc, keep)).toBeUndefined();
  });

  it('TC-08 undoing my delete restores the content as of my delete', () => {
    const { doc, undo, peer } = setup();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    step(undo);
    getStickyText(peer, id)!.insert(0, 'peer text');
    deleteObjects(doc, [id]);
    undo.undo();
    expect(get(doc, id)!.text).toBe('peer text');
  });

  it('TC-09 at UNDO_MAX_STEPS the oldest step is dropped', () => {
    const { doc, undo } = setup();
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: i, y: i }) as string);
      step(undo);
    }
    let n = 0;
    while (undo.undo()) n++;
    expect(n).toBe(UNDO_MAX_STEPS);
    expect(get(doc, ids[0])).toBeTruthy(); // the oldest creation can no longer be undone
    expect(get(doc, ids[1])).toBeUndefined();
  });

  it('TC-10 one below UNDO_MAX_STEPS plus one drops nothing', () => {
    const { doc, undo } = setup();
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i, y: i });
      step(undo);
    }
    let n = 0;
    while (undo.undo()) n++;
    expect(n).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a fresh controller after destroy starts empty', () => {
    const { doc, undo } = setup();
    createSticky(doc, { x: 0, y: 0 });
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
    expect(createUndo(doc).canUndo()).toBe(false);
  });

  it('notifies onChange subscribers', () => {
    const { doc, undo } = setup();
    let calls = 0;
    const off = undo.onChange(() => calls++);
    createSticky(doc, { x: 0, y: 0 });
    expect(calls).toBeGreaterThan(0);
    off();
  });
});
