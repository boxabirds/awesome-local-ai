import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, getStickyText, initDoc, moveObject, setStickyColor, snapshot, stickies } from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

const REMOTE = 'remote';
const LOAD = 'load';

/** A second real doc exchanging updates with `doc`; applied with a non-local origin. */
function peerOf(doc: Y.Doc, origin: unknown = REMOTE) {
  const peer = new Y.Doc();
  initDoc(peer);
  const sync = () => {
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(peer)), 'toPeer');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)), origin);
  };
  return { peer, sync };
}

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = createUndo(doc, { captureTimeoutMs: 0 });
  return { doc, undo };
}

describe('undo history', () => {
  it('TC-01 undo reverses my move but not the peer’s creation or recolour', () => {
    const { doc, undo } = setup();
    const x = createSticky(doc, { x: 0, y: 0 });
    const z = createSticky(doc, { x: 500, y: 0 });
    const { peer, sync } = peerOf(doc);
    sync();
    undo.boundary();
    const before = stickies(doc).find((s) => s.id === x)!;
    moveObject(doc, x, 300, 300);
    undo.boundary();
    const y = createSticky(peer, { x: 900, y: 0 });
    setStickyColor(peer, z, 'blue');
    sync();
    expect(undo.undo()).toBe(true);
    const snap = stickies(doc);
    expect(snap.find((s) => s.id === x)).toMatchObject({ x: before.x, y: before.y });
    expect(snap.find((s) => s.id === y)).toBeDefined();
    expect(snap.find((s) => s.id === z)!.color).toBe('blue');
  });

  it('TC-02 remote-only changes leave nothing to undo', () => {
    const { doc, undo } = setup();
    const { peer, sync } = peerOf(doc);
    createSticky(peer, { x: 0, y: 0 });
    sync();
    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-03 load-origin updates are not captured', () => {
    const { doc, undo } = setup();
    const { peer, sync } = peerOf(doc, LOAD);
    createSticky(peer, { x: 0, y: 0 });
    sync();
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04 undoing a delete of 8 notes restores text, colour, size and position', () => {
    const { doc, undo } = setup();
    const ids = Array.from({ length: 8 }, (_, i) => {
      const id = createSticky(doc, { x: i * 250, y: i * 10 }, i % 2 ? 'blue' : 'pink');
      getStickyText(doc, id)!.insert(0, `note ${i}`);
      return id;
    });
    undo.boundary();
    const before = JSON.stringify(snapshot(doc));
    deleteObjects(doc, ids);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.undo()).toBe(true);
    expect(JSON.stringify(snapshot(doc))).toBe(before);
  });

  it('TC-05 undo then redo re-applies a move', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    const start = snapshot(doc)[0];
    moveObject(doc, id, 400, 400);
    const moved = snapshot(doc)[0];
    undo.undo();
    expect(snapshot(doc)[0]).toMatchObject({ x: start.x, y: start.y });
    expect(undo.canRedo()).toBe(true);
    undo.redo();
    expect(snapshot(doc)[0]).toMatchObject({ x: moved.x, y: moved.y });
  });

  it('TC-06 a new change after undo clears redo', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    setStickyColor(doc, id, 'blue');
    undo.boundary();
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    setStickyColor(doc, id, 'green');
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07 undoing a move of a note deleted remotely does nothing, and the next undo works', () => {
    const { doc, undo } = setup();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    undo.boundary();
    const bStart = snapshot(doc).find((o) => o.id === b)!;
    moveObject(doc, b, 900, 900);
    undo.boundary();
    moveObject(doc, a, 100, 100);
    undo.boundary();
    const { peer, sync } = peerOf(doc);
    sync();
    deleteObjects(peer, [a]);
    sync();
    // The step for the deleted note has no effect; it is skipped so the press still undoes something real.
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc).find((o) => o.id === a)).toBeUndefined();
    expect(snapshot(doc).find((o) => o.id === b)).toMatchObject({ x: bStart.x, y: bStart.y });
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc).find((o) => o.id === a)).toBeUndefined();
  });

  it('TC-08 undoing my delete restores the content as of my delete', () => {
    const { doc, undo } = setup();
    const id = createSticky(doc, { x: 0, y: 0 });
    const { peer, sync } = peerOf(doc);
    sync();
    undo.boundary();
    getStickyText(peer, id)!.insert(0, 'from peer');
    sync();
    deleteObjects(doc, [id]);
    expect(undo.undo()).toBe(true);
    expect(stickies(doc)[0].text).toBe('from peer');
  });

  it('TC-09 at UNDO_MAX_STEPS a new step drops the oldest', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      createSticky(doc, { x: i, y: 0 });
      undo.boundary();
    }
    let steps = 0;
    while (undo.undo()) steps++;
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(1); // the oldest creation could not be undone
  });

  it('TC-10 at UNDO_MAX_STEPS − 1 a new step drops nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: i, y: 0 });
      undo.boundary();
    }
    while (undo.undo());
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a new controller (reload) starts empty', () => {
    const { doc, undo } = setup();
    createSticky(doc, { x: 0, y: 0 });
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
    expect(createUndo(doc).canUndo()).toBe(false);
  });

  it('notifies subscribers when stacks change', () => {
    const { doc, undo } = setup();
    let n = 0;
    const off = undo.onChange(() => n++);
    createSticky(doc, { x: 0, y: 0 });
    undo.undo();
    expect(n).toBeGreaterThanOrEqual(2);
    off();
  });
});
