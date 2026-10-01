import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import {
  createSticky, deleteObjects, getStickyText, initDoc, moveObjects, setStickyColor, snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';

const REMOTE = Symbol('provider');
const LOAD = Symbol('load');

/** Two docs that exchange updates with a non-local origin (a simulated server and peer). */
function pair() {
  const local = new Y.Doc();
  const peer = new Y.Doc();
  initDoc(local);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), 'from-local');
  local.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== REMOTE) Y.applyUpdate(peer, u, 'from-local'); });
  peer.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'from-local') Y.applyUpdate(local, u, REMOTE); });
  return { local, peer };
}

const byId = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id);

describe('undo.history', () => {
  it('TC-01 undo restores my move and leaves remote changes alone', () => {
    const { local, peer } = pair();
    const x = createSticky(local, { x: 0, y: 0 }) as string;
    const z = createSticky(local, { x: 500, y: 0 }) as string;
    const undo = createUndo(local);
    moveObjects(local, new Map([[x, { x: 300, y: 300 }]]));
    const before = byId(local, x)!;
    expect(before.x).toBe(300);
    const y = createSticky(peer, { x: 900, y: 900 }) as string;
    setStickyColor(peer, z, 'pink');
    expect(undo.undo()).toBe(true);
    expect(byId(local, x)!.x).toBe(-100);
    expect(byId(local, y)).toBeTruthy();
    expect(byId(local, z)!.color).toBe('pink');
  });

  it('TC-02 remote-only changes leave nothing to undo', () => {
    const { local, peer } = pair();
    const undo = createUndo(local);
    createSticky(peer, { x: 0, y: 0 });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-03 load-origin updates are not tracked', () => {
    const source = new Y.Doc();
    initDoc(source);
    createSticky(source, { x: 0, y: 0 });
    const local = new Y.Doc();
    const undo = createUndo(local);
    Y.applyUpdate(local, Y.encodeStateAsUpdate(source), LOAD);
    expect(snapshot(local)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04 undoing a delete of 8 notes restores text, colour, size and position', () => {
    const { local } = pair();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(local, { x: i * 250, y: i * 10 }, i % 2 ? 'blue' : 'green') as string;
      getStickyText(local, id)!.insert(0, `note ${i}`);
      ids.push(id);
    }
    local.transact(() => {
      (local.getMap('objects').get(ids[0]) as Y.Map<unknown>).set('width', 321);
    });
    const expected = snapshot(local);
    const undo = createUndo(local);
    deleteObjects(local, ids);
    expect(snapshot(local)).toHaveLength(0);
    undo.undo();
    expect(snapshot(local)).toEqual(expected);
  });

  it('TC-05 redo re-applies the undone move', () => {
    const { local } = pair();
    const id = createSticky(local, { x: 0, y: 0 }) as string;
    const undo = createUndo(local);
    moveObjects(local, new Map([[id, { x: 50, y: 60 }]]));
    undo.undo();
    expect(byId(local, id)!.x).toBe(-100);
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(byId(local, id)).toMatchObject({ x: 50, y: 60 });
  });

  it('TC-06 a new change after undo clears redo', () => {
    const { local } = pair();
    const id = createSticky(local, { x: 0, y: 0 }) as string;
    const undo = createUndo(local);
    setStickyColor(local, id, 'pink');
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    undo.boundary();
    setStickyColor(local, id, 'blue');
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07 undoing a move of an object deleted remotely does nothing and does not throw', () => {
    const { local, peer } = pair();
    const a = createSticky(local, { x: 0, y: 0 }) as string;
    const b = createSticky(local, { x: 500, y: 0 }) as string;
    const undo = createUndo(local);
    setStickyColor(local, b, 'pink');
    undo.boundary();
    moveObjects(local, new Map([[a, { x: 40, y: 40 }]]));
    deleteObjects(peer, [a]);
    expect(() => undo.undo()).not.toThrow();
    expect(byId(local, a)).toBeUndefined();
    expect(snapshot(local)).toHaveLength(1);
    expect(byId(local, b)!.color).toBe('pink'); // the no-op step did not skip into the next one
    undo.undo();
    expect(byId(local, b)!.color).toBe('yellow');
    expect(snapshot(local)).toHaveLength(1);
  });

  it('TC-08 undoing my delete restores content as of my delete', () => {
    const { local, peer } = pair();
    const id = createSticky(local, { x: 0, y: 0 }) as string;
    const undo = createUndo(local);
    getStickyText(peer, id)!.insert(0, 'peer was here');
    deleteObjects(local, [id]);
    undo.undo();
    expect(byId(local, id)!.text).toBe('peer was here');
  });

  it('TC-09 at UNDO_MAX_STEPS the oldest step is dropped', () => {
    const { local } = pair();
    const undo = createUndo(local);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      undo.boundary();
      ids.push(createSticky(local, { x: i, y: 0 }) as string);
    }
    let n = 0;
    while (undo.undo()) n++;
    expect(n).toBe(UNDO_MAX_STEPS);
    expect(snapshot(local).map((o) => o.id)).toEqual([ids[0]]);
  });

  it('TC-10 below the limit nothing is dropped', () => {
    const { local } = pair();
    const undo = createUndo(local);
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      undo.boundary();
      createSticky(local, { x: i, y: 0 });
    }
    let n = 0;
    while (undo.undo()) n++;
    expect(n).toBe(UNDO_MAX_STEPS);
    expect(snapshot(local)).toHaveLength(0);
  });

  it('TC-11 a fresh controller after destroy starts empty', () => {
    const { local } = pair();
    const undo = createUndo(local);
    createSticky(local, { x: 0, y: 0 });
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
    expect(createUndo(local).canUndo()).toBe(false);
  });

  it('onChange fires on add and pop and can unsubscribe', () => {
    const { local } = pair();
    const undo = createUndo(local);
    let calls = 0;
    const off = undo.onChange(() => { calls++; });
    createSticky(local, { x: 0, y: 0 });
    undo.undo();
    expect(calls).toBeGreaterThanOrEqual(2);
    off();
    const seen = calls;
    undo.redo();
    expect(calls).toBe(seen);
  });
});
