import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  objectSnapshot,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { applyLoaded, linkPeer, type Peer } from './helpers/peer';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const DELETED_NOTES = 8;
const SPACING = 150;
const MOVE = 300;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function controller(doc: Y.Doc): UndoController {
  const ctl = createUndo(doc);
  cleanups.push(() => ctl.destroy());
  return ctl;
}

function peerOf(doc: Y.Doc): Peer {
  const peer = linkPeer(doc);
  cleanups.push(() => peer.disconnect());
  return peer;
}

function note(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((n) => n.id === id);
}

function setText(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id)!;
  doc.transact(() => ytext.insert(ytext.length, text), LOCAL_ORIGIN);
}

/** One user action: its own step, never merged with neighbours. */
function step<T>(ctl: UndoController, action: () => T): T {
  ctl.boundary();
  const result = action();
  ctl.boundary();
  return result;
}

describe('undo.history', () => {
  it('TC-01 undo reverses my move only: peer-created and peer-recoloured notes are untouched', () => {
    const doc = newDoc();
    const x = createSticky(doc, { x: 0, y: 0 });
    const z = createSticky(doc, { x: 500, y: 0 }, 'yellow');
    const ctl = controller(doc);
    const peer = peerOf(doc);
    const start = note(doc, x)!;

    step(ctl, () => moveObject(doc, x, start.x + MOVE, start.y + MOVE));
    const y = createSticky(peer.doc, { x: 900, y: 900 });
    setStickyColor(peer.doc, z, 'blue');

    expect(ctl.undo()).toBe(true);
    expect(note(doc, x)).toMatchObject({ x: start.x, y: start.y });
    expect(note(doc, y)).toBeDefined();
    expect(note(doc, z)!.color).toBe('blue');
    // The peer sees the same board.
    expect(note(peer.doc, x)).toMatchObject({ x: start.x, y: start.y });
    expect(snapshot(peer.doc)).toEqual(snapshot(doc));
    expect(ctl.canUndo()).toBe(false);
  });

  it('TC-02 changes made only by other people are never undoable', () => {
    const doc = newDoc();
    const ctl = controller(doc);
    const peer = peerOf(doc);
    const id = createSticky(peer.doc, { x: 0, y: 0 });
    setStickyColor(peer.doc, id, 'green');
    setText(peer.doc, id, 'from Raj');
    deleteObjects(peer.doc, [id]);
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.canRedo()).toBe(false);
    expect(ctl.undo()).toBe(false);
    expect(ctl.redo()).toBe(false);
  });

  it('TC-03 a saved board loaded with the LOAD origin is not undoable', () => {
    const saved = newDoc();
    for (let i = 0; i < 3; i += 1) createSticky(saved, { x: i * SPACING, y: 0 });
    const doc = new Y.Doc();
    const ctl = controller(doc);
    applyLoaded(doc, saved);
    expect(snapshot(doc)).toHaveLength(3);
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(3);
  });

  it('TC-04 one undo restores all 8 deleted notes with text, colour, size and position', () => {
    const doc = newDoc();
    const ids = Array.from({ length: DELETED_NOTES }, (_, i) => {
      const id = createSticky(doc, { x: i * SPACING, y: (i % 2) * SPACING }, COLORS[i % COLORS.length]);
      setText(doc, id, `Idea ${i + 1}`);
      return id;
    });
    resizeObjects(doc, new Map([[ids[0]!, { x: -100, y: -100, width: 320, height: 240 }]]));
    const keep = createSticky(doc, { x: 2000, y: 2000 });
    const ctl = controller(doc);
    const before = objectSnapshot(doc);

    step(ctl, () => deleteObjects(doc, ids));
    expect(snapshot(doc).map((n) => n.id)).toEqual([keep]);

    expect(ctl.undo()).toBe(true);
    expect(objectSnapshot(doc)).toEqual(before);
    expect(note(doc, ids[0]!)).toMatchObject({ width: 320, height: 240, x: -100, y: -100, text: 'Idea 1' });
  });

  it('TC-05 undo then redo re-applies the move', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ctl = controller(doc);
    const start = note(doc, id)!;
    step(ctl, () => moveObject(doc, id, 40, 50));
    expect(ctl.canRedo()).toBe(false);
    ctl.undo();
    expect(note(doc, id)).toMatchObject({ x: start.x, y: start.y });
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.canRedo()).toBe(true);
    expect(ctl.redo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 40, y: 50 });
    expect(ctl.canUndo()).toBe(true);
    expect(ctl.canRedo()).toBe(false);
  });

  it('TC-06 a new change after undoing clears redo', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const ctl = controller(doc);
    step(ctl, () => setStickyColor(doc, id, 'pink'));
    ctl.undo();
    expect(ctl.canRedo()).toBe(true);
    step(ctl, () => setStickyColor(doc, id, 'green'));
    expect(ctl.canRedo()).toBe(false);
    expect(ctl.redo()).toBe(false);
    expect(note(doc, id)!.color).toBe('green');
  });

  it('TC-06b a remote change after undoing does not clear my redo', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const other = createSticky(doc, { x: 600, y: 0 });
    const ctl = controller(doc);
    const peer = peerOf(doc);
    step(ctl, () => setStickyColor(doc, id, 'pink'));
    ctl.undo();
    setStickyColor(peer.doc, other, 'violet');
    expect(ctl.canRedo()).toBe(true);
    ctl.redo();
    expect(note(doc, id)!.color).toBe('pink');
  });

  it('TC-07 undoing a move of a note the peer deleted: no throw, stays deleted, earlier step untouched, next undo works', () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 600, y: 0 });
    const ctl = controller(doc);
    const peer = peerOf(doc);
    step(ctl, () => setStickyColor(doc, b, 'orange'));
    step(ctl, () => moveObject(doc, a, 999, 999));
    deleteObjects(peer.doc, [a]);
    const board = snapshot(doc);

    expect(() => ctl.undo()).not.toThrow();
    expect(note(doc, a)).toBeUndefined();
    expect(note(peer.doc, a)).toBeUndefined();
    // Nothing visible happened: the colour step below it was not undone in the same press.
    expect(snapshot(doc)).toEqual(board);
    expect(ctl.canUndo()).toBe(true);

    expect(ctl.undo()).toBe(true);
    expect(note(doc, b)!.color).toBe('yellow');
    expect(note(doc, a)).toBeUndefined();
  });

  it('TC-08 undoing my delete restores the text the note had when I deleted it (including the peer\'s typing)', () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }, 'green');
    setText(doc, id, 'Mine. ');
    const ctl = controller(doc);
    const peer = peerOf(doc);
    setText(peer.doc, id, 'Raj added this.');
    const atDelete = note(doc, id)!;
    expect(atDelete.text).toBe('Mine. Raj added this.');

    step(ctl, () => deleteObjects(doc, [id]));
    expect(ctl.undo()).toBe(true);
    expect(note(doc, id)).toEqual(atDelete);
    expect(note(peer.doc, id)).toEqual(atDelete);
  });

  it(`TC-09 at UNDO_MAX_STEPS (${UNDO_MAX_STEPS}) one more step drops the oldest`, () => {
    const doc = newDoc();
    const ctl = controller(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i += 1) ids.push(step(ctl, () => createSticky(doc, { x: i, y: 0 })));
    let undone = 0;
    while (ctl.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    // The oldest creation can no longer be undone; every later one was.
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[0]]);
  });

  it(`TC-10 at UNDO_MAX_STEPS − 1 one more step drops nothing`, () => {
    const doc = newDoc();
    const ctl = controller(doc);
    for (let i = 0; i < UNDO_MAX_STEPS; i += 1) step(ctl, () => createSticky(doc, { x: i, y: 0 }));
    let undone = 0;
    while (ctl.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11 a fresh controller (page reload) starts with empty history', () => {
    const doc = newDoc();
    const first = createUndo(doc);
    step(first, () => createSticky(doc, { x: 0, y: 0 }));
    expect(first.canUndo()).toBe(true);
    first.destroy();
    const second = controller(doc);
    expect(second.canUndo()).toBe(false);
    expect(second.undo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('onChange fires when the stacks change; unsubscribe stops it; destroy stops tracking', () => {
    const doc = newDoc();
    const ctl = createUndo(doc);
    let calls = 0;
    const off = ctl.onChange(() => {
      calls += 1;
    });
    const id = step(ctl, () => createSticky(doc, { x: 0, y: 0 }));
    expect(calls).toBeGreaterThan(0);
    const afterAdd = calls;
    ctl.undo();
    expect(calls).toBeGreaterThan(afterAdd);
    off();
    const afterOff = calls;
    ctl.redo();
    expect(calls).toBe(afterOff);
    expect(note(doc, id)).toBeDefined();
    ctl.destroy();
    step(ctl, () => createSticky(doc, { x: 1, y: 0 }));
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });

  it('addScope tracks another shared type (story 16 comments)', () => {
    const doc = newDoc();
    const ctl = controller(doc);
    const comments = doc.getMap('comments');
    doc.transact(() => comments.set('c1', 'untracked'), LOCAL_ORIGIN);
    expect(ctl.canUndo()).toBe(false);
    ctl.addScope(comments as Y.AbstractType<unknown>);
    step(ctl, () => doc.transact(() => comments.set('c2', 'tracked'), LOCAL_ORIGIN));
    expect(ctl.undo()).toBe(true);
    expect(comments.has('c2')).toBe(false);
    expect(comments.get('c1')).toBe('untracked');
  });
});
