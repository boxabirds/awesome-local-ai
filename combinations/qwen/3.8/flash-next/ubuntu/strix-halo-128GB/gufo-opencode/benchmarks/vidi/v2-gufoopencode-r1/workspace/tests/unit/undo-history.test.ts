import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import {
  deleteObjects,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { makeSticky } from '../fixtures/stickies';
import { applyAsLoad, encode, linkPeers } from './peer';

function noteOf(doc: Y.Doc, id: string): { x: number; y: number; color: string; width: number } {
  const entry = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (entry === undefined) throw new Error(`note ${id} missing`);
  return {
    x: entry.get('x') as number,
    y: entry.get('y') as number,
    color: entry.get('color') as string,
    width: entry.get('width') as number
  };
}

describe('undo.history', () => {
  test('TC-01 undo restores own move and never touches remote changes', () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    linkPeers(local, peer);
    const x = makeSticky(local, 0, 0);
    const z = makeSticky(local, 300, 0);
    peer.transact(() => Y.applyUpdate(peer, encode(local)));
    const controller = createUndo(local);

    moveObject(local, x, 50, 50);
    moveObject(peer, z, 400, 400);
    peer.transact(() => setStickyColor(peer, z, 'pink'));

    expect(controller.undo()).toBe(true);
    expect(noteOf(local, x)).toMatchObject({ x: -100, y: -100 });
    expect(local.getMap('objects').has(z)).toBe(true);
    // Remote changes stay exactly as the peer made them.
    expect(noteOf(local, z)).toMatchObject({ x: 400, y: 400, color: 'pink' });
    controller.destroy();
  });

  test('TC-02 peer-only changes leave nothing to undo', () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    linkPeers(local, peer);
    const id = makeSticky(local, 0, 0);
    peer.transact(() => Y.applyUpdate(peer, encode(local)));
    const controller = createUndo(local);

    moveObject(peer, id, 10, 10);
    setStickyColor(peer, id, 'blue');

    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
    controller.destroy();
  });

  test('TC-03 load-origin updates are not undoable', () => {
    const stored = new Y.Doc();
    makeSticky(stored, 0, 0);
    makeSticky(stored, 200, 0);
    const update = encode(stored);

    const local = new Y.Doc();
    applyAsLoad(local, update);
    const controller = createUndo(local);
    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
    expect(snapshot(local).length).toBe(2);

    const id = snapshot(local)[0].id;
    moveObject(local, id, 0, 0);
    expect(controller.canUndo()).toBe(true);
    controller.destroy();
  });

  test('TC-04 undoing a bulk delete restores text, colour, size and position', () => {
    const doc = new Y.Doc();
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) ids.push(makeSticky(doc, i * 240, 0));
    doc.transact(() => {
      for (const id of ids) getStickyText(doc, id)?.insert(0, `note ${id.slice(0, 4)}`);
    }, LOCAL_ORIGIN);
    const controller = createUndo(doc);

    const before = ids.map((id) => noteOf(doc, id));
    const texts = ids.map((id) => getStickyText(doc, id)?.toString());
    doc.transact(() => {
      ids.forEach((id, i) => setStickyColor(doc, id, ['orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'orange', 'green'][i]));
    }, LOCAL_ORIGIN);
    controller.boundary();
    const coloured = ids.map((id) => noteOf(doc, id));
    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc).length).toBe(0);

    expect(controller.undo()).toBe(true);
    expect(snapshot(doc).length).toBe(8);
    ids.forEach((id, i) => {
      expect(noteOf(doc, id)).toEqual(coloured[i]);
      expect(getStickyText(doc, id)?.toString()).toBe(texts[i]);
    });
    expect(before.every((n) => n.width === 200)).toBe(true);
    controller.destroy();
  });

  test('TC-05 undo then redo re-applies the change', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const controller = createUndo(doc);
    let changes = 0;
    controller.onChange(() => {
      changes += 1;
    });

    moveObject(doc, id, 40, 60);
    expect(changes).toBe(1);
    expect(controller.undo()).toBe(true);
    expect(noteOf(doc, id)).toMatchObject({ x: -100, y: -100 });
    expect(controller.canRedo()).toBe(true);
    expect(controller.redo()).toBe(true);
    expect(noteOf(doc, id)).toMatchObject({ x: 40, y: 60 });
    // move: added; undo: added(redo)+popped; redo: added(undo)+popped.
    expect(changes).toBe(5);
    controller.destroy();
  });

  test('TC-06 a new change after undo clears the redo stack', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const controller = createUndo(doc);

    moveObject(doc, id, 40, 60);
    controller.boundary();
    expect(controller.undo()).toBe(true);
    expect(controller.canRedo()).toBe(true);

    moveObject(doc, id, 20, 20);
    expect(controller.canRedo()).toBe(false);
    expect(controller.redo()).toBe(false);
    controller.destroy();
  });

  test('TC-07 undo of a move whose target was deleted remotely never throws', () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    linkPeers(local, peer);
    const a = makeSticky(local, 0, 0);
    const b = makeSticky(local, 500, 0);
    peer.transact(() => Y.applyUpdate(peer, encode(local)));
    const controller = createUndo(local);

    moveObject(local, a, 60, 60);
    controller.boundary();
    moveObject(local, b, 70, 70);
    controller.boundary();
    peer.transact(() => {
      peer.getMap('objects').delete(b);
    });

    expect(() => controller.undo()).not.toThrow();
    // The move's inverse has no effect on the remotely deleted note; the first
    // effective step is reverted and the stack drains cleanly.
    expect(local.getMap('objects').has(b)).toBe(false);
    expect(noteOf(local, a)).toMatchObject({ x: -100, y: -100 });
    expect(() => controller.undo()).not.toThrow();
    expect(controller.canUndo()).toBe(false);

    // History stays usable: a new local step undoes normally.
    moveObject(local, a, 20, 20);
    expect(controller.undo()).toBe(true);
    expect(noteOf(local, a)).toMatchObject({ x: -100, y: -100 });
    controller.destroy();
  });

  test('TC-08 undoing a delete restores the note with content current at delete time', () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    linkPeers(local, peer);
    const id = makeSticky(local, 0, 0);
    local.transact(() => getStickyText(local, id)?.insert(0, 'hello'), LOCAL_ORIGIN);
    peer.transact(() => Y.applyUpdate(peer, encode(local)));

    const controller = createUndo(local);
    peer.transact(() => getStickyText(peer, id)?.insert(5, ' R'));
    expect(getStickyText(local, id)?.toString()).toBe('hello R');

    expect(deleteObjects(local, [id])).toBe(1);
    expect(controller.undo()).toBe(true);
    expect(getStickyText(local, id)?.toString()).toBe('hello R');
    controller.destroy();
  });

  test('TC-09 history is capped at UNDO_MAX_STEPS, oldest dropped', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const controller = createUndo(doc);
    for (let i = 1; i <= UNDO_MAX_STEPS + 1; i += 1) {
      moveObject(doc, id, i, 0);
      controller.boundary();
    }
    let undos = 0;
    while (controller.undo()) {
      undos += 1;
      if (undos > UNDO_MAX_STEPS + 5) throw new Error('undo stack longer than the cap');
    }
    expect(undos).toBe(UNDO_MAX_STEPS);
    // The oldest surviving history is the state after step 1; step 1 itself
    // (x = 1) is what got dropped from the front, so unwinding stops there.
    expect(noteOf(doc, id).x).toBe(1);
    controller.destroy();
  });

  test('TC-10 exactly UNDO_MAX_STEPS steps drop nothing', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const controller = createUndo(doc);
    for (let i = 1; i <= UNDO_MAX_STEPS; i += 1) {
      moveObject(doc, id, i, 0);
      controller.boundary();
    }
    let undos = 0;
    while (controller.undo()) {
      undos += 1;
      if (undos > UNDO_MAX_STEPS + 5) throw new Error('undo stack longer than the cap');
    }
    expect(undos).toBe(UNDO_MAX_STEPS);
    expect(noteOf(doc, id).x).toBe(-100);
    controller.destroy();
  });

  test('TC-11 history is session-only: a fresh controller after destroy is empty', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const first = createUndo(doc);
    moveObject(doc, id, 30, 30);
    expect(first.canUndo()).toBe(true);
    first.destroy();
    expect(first.undo()).toBe(false);

    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
    second.destroy();
  });
});
