import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { applyAsLoadUpdate, createPeer } from './peer';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function note(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

function makeNote(doc: Y.Doc, at: { x: number; y: number }, text = ''): string {
  const id = createSticky(doc, at);
  if (text !== '') {
    doc.transact(() => {
      getStickyText(doc, id)?.insert(0, text);
    }, LOCAL_ORIGIN);
  }
  return id;
}

describe('undo.history', () => {
  test('TC-01: undo reverses my move and never the peer create or recolour', () => {
    const doc = newDoc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);
    const x = makeNote(doc, { x: 0, y: 0 });
    const z = makeNote(doc, { x: 300, y: 0 });
    undo.boundary();
    moveObject(doc, x, 100, 50);
    undo.boundary();

    const y = createSticky(peer.doc, { x: 600, y: 0 });
    setStickyColor(peer.doc, z, 'blue');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    const moved = note(doc, x);
    expect(moved).toBeDefined();
    expect({ x: moved!.x, y: moved!.y }).toEqual({ x: -100, y: -100 }); // creation position
    expect(snapshot(doc).some((n) => n.id === y)).toBe(true); // peer note still there
    expect(note(doc, z)!.color).toBe('blue'); // peer colour kept
    peer.destroy();
    undo.destroy();
  });

  test('TC-02: remote changes alone leave nothing to undo', () => {
    const doc = newDoc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);
    const z = createSticky(peer.doc, { x: 0, y: 0 }); // peer creates it
    setStickyColor(peer.doc, z, 'green'); // peer recolours it

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
    expect(note(doc, z)!.color).toBe('green'); // nothing reversed
    peer.destroy();
    undo.destroy();
  });

  test('TC-03: story 4 load-origin updates are not captured', () => {
    const doc = newDoc();
    const stored = newDoc();
    const a = makeNote(stored, { x: 0, y: 0 }, 'restored');
    makeNote(stored, { x: 300, y: 0 });
    const undo = createUndo(doc);

    applyAsLoadUpdate(doc, stored);

    expect(snapshot(doc)).toHaveLength(2);
    expect(note(doc, a)!.text).toBe('restored');
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    undo.destroy();
  });

  test('TC-04: undoing a delete of 8 notes restores text, colour, size and position', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const ids: string[] = [];
    const before: StickySnapshot[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = createSticky(doc, { x: 100 + i * 250, y: 100 + i * 60 }, colors[i]);
      doc.transact(() => {
        getStickyText(doc, id)?.insert(0, `note ${i}`);
      }, LOCAL_ORIGIN);
      resizeObjects(doc, new Map([[id, { x: 100 + i * 250 - 50, y: 100 + i * 60 - 25, width: 120 + i * 10, height: 140 + i * 10 }]]));
      ids.push(id);
      const snap = note(doc, id);
      if (snap === undefined) throw new Error('note missing');
      before.push(snap);
    }
    undo.boundary();
    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const want of before) {
      const got = note(doc, want.id);
      expect(got).toBeDefined();
      expect({ x: got!.x, y: got!.y }).toEqual({ x: want.x, y: want.y });
      expect({ width: got!.width, height: got!.height }).toEqual({
        width: want.width,
        height: want.height
      });
      expect(got!.color).toBe(want.color);
      expect(got!.text).toBe(want.text);
    }
    undo.destroy();
  });

  test('TC-05: redo re-applies my undone move', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const id = makeNote(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 40, 20);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect({ x: note(doc, id)!.x, y: note(doc, id)!.y }).toEqual({ x: -100, y: -100 });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect({ x: note(doc, id)!.x, y: note(doc, id)!.y }).toEqual({ x: 40, y: 20 });
    expect(undo.canRedo()).toBe(false);
    undo.destroy();
  });

  test('TC-06: a new local change clears the redo stack', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const id = makeNote(doc, { x: 0, y: 0 });
    undo.boundary();
    setStickyColor(doc, id, 'pink');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(note(doc, id)!.color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    makeNote(doc, { x: 500, y: 0 });
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    undo.destroy();
  });

  test('TC-07: undoing the move of a remotely deleted note neither throws nor recreates it', () => {
    const doc = newDoc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);
    const x = makeNote(doc, { x: 0, y: 0 });
    makeNote(doc, { x: 300, y: 0 });
    undo.boundary();
    moveObject(doc, x, 80, 80);
    undo.boundary();

    deleteObjects(peer.doc, [x]); // peer deletes the move target
    expect(snapshot(doc).some((n) => n.id === x)).toBe(false);

    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc).some((n) => n.id === x)).toBe(false); // stays deleted

    // The controller stays healthy: a fresh change is captured and undoable.
    const w = makeNote(doc, { x: 900, y: 0 });
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).some((n) => n.id === w)).toBe(false);
    peer.destroy();
    undo.destroy();
  });

  test('TC-08: undoing my delete restores a note with the peer edit it had then', () => {
    const doc = newDoc();
    const peer = createPeer(doc);
    const undo = createUndo(doc);
    const id = makeNote(doc, { x: 0, y: 0 }, 'mine');
    undo.boundary();

    const peerText = getStickyText(peer.doc, id);
    if (peerText === undefined) throw new Error('peer text missing');
    peerText.insert(peerText.length, ' + peer');
    expect(getStickyText(doc, id)!.toString()).toBe('mine + peer');

    deleteObjects(doc, [id]);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(note(doc, id)!.text).toBe('mine + peer');
    peer.destroy();
    undo.destroy();
  });

  test('TC-09: one step beyond UNDO_MAX_STEPS drops the oldest', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) {
      undo.boundary();
      ids.push(makeNote(doc, { x: i * 300, y: 0 }));
    }
    undo.boundary();
    ids.push(makeNote(doc, { x: UNDO_MAX_STEPS * 300, y: 0 }));
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) {
      expect(undo.undo()).toBe(true);
    }
    const left = snapshot(doc);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(ids[0]); // the dropped oldest step is not undoable
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  test('TC-10: reaching UNDO_MAX_STEPS exactly drops nothing', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i += 1) {
      undo.boundary();
      makeNote(doc, { x: i * 300, y: 0 });
    }
    undo.boundary();
    makeNote(doc, { x: (UNDO_MAX_STEPS - 1) * 300, y: 0 });
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);

    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) {
      expect(undo.undo()).toBe(true);
    }
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  test('TC-11: history is session-only; a fresh controller starts empty', () => {
    const doc = newDoc();
    const first = createUndo(doc);
    makeNote(doc, { x: 0, y: 0 });
    expect(first.canUndo()).toBe(true);

    first.destroy();
    expect(first.canUndo()).toBe(false);
    expect(first.undo()).toBe(false);

    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
    second.destroy();
  });

  test('onChange reports capture, undo and redo', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const seen: string[] = [];
    const off = undo.onChange(() => seen.push(`${undo.canUndo()}/${undo.canRedo()}`));

    makeNote(doc, { x: 0, y: 0 });
    expect(seen.at(-1)).toBe('true/false');
    undo.undo();
    expect(seen.at(-1)).toBe('false/true');
    undo.redo();
    expect(seen.at(-1)).toBe('true/false');

    seen.length = 0;
    off();
    makeNote(doc, { x: 300, y: 0 });
    expect(seen).toEqual([]);
    undo.destroy();
  });

  test('addScope extends the scope without losing history', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    makeNote(doc, { x: 0, y: 0 });
    const extra = doc.getMap('comments');
    undo.addScope(extra);
    undo.boundary();
    doc.transact(() => extra.set('c1', 'hi'), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(extra.get('c1')).toBeUndefined();
    expect(snapshot(doc)).toHaveLength(1); // the earlier note is still undoable
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });
});
