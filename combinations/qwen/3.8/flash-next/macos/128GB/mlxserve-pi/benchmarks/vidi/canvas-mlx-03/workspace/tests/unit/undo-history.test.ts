// Story 8 `undo.history` unit cases (TC-01 to TC-11).
//
// Everything here runs on real documents: the board's `Y.Doc`, a second real
// `Y.Doc` acting as a colleague whose updates arrive with a non-local origin (the
// way the websocket provider applies them), and a real `Y.UndoManager` behind the
// controller. Nothing about undo behaviour is mocked — the only thing a test
// supplies is the sequence of user actions.
//
// One convention matters: `step()` puts the boundary that story 8's wiring puts
// around a single user action *before and after* the model call, so "one action,
// one undo step" is what is under test rather than an artefact of timing. Tests
// that are about timing live in `undo-boundaries.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObjects,
  objectBounds,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.ts';
import { UNDO_MAX_STEPS } from '../../src/shared/config.ts';
import {
  addSticky,
  applyWithLoadOrigin,
  connectPeer,
  move as peerMove,
  remove as peerRemove,
  setColor,
  type Peer,
  type PeerStickySeed,
} from './helpers/peer.ts';

let doc: Y.Doc;
let peer: Peer;
let undo: UndoController;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  peer = connectPeer(doc);
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
  peer.stop();
  doc.destroy();
});

/** One user action: the boundaries the board's wiring puts around it. */
function step(fn: () => unknown): void {
  undo.boundary();
  fn();
  undo.boundary();
}

const note = (id: string): StickySnapshot => {
  const found = snapshot(doc).find((n) => n.id === id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
};

const present = (id: string): boolean => snapshot(doc).some((n) => n.id === id);

/** A note created by me, in its own undo step. */
function mySticky(text: string, x: number, y: number): string {
  let id = '';
  step(() => {
    id = createSticky(doc, { x, y });
    getStickyText(doc, id)?.insert(0, text);
  });
  return id;
}

/** How the board looks, without the parts two documents cannot agree on. */
function boardState(d: Y.Doc = doc): string {
  return snapshot(d)
    .map((n) => {
      const r = objectBounds(n);
      return `${n.text}|${n.color}|${n.x},${n.y}|${r.width}x${r.height}|${n.z}`;
    })
    .sort()
    .join('\n');
}

/** Move one of my notes: one step, one transaction. */
function moveNote(id: string, x: number, y: number): void {
  step(() => moveObjects(doc, new Map([[id, { x, y }]])));
}

/** Undo until the controller says there is nothing left; returns how many steps. */
function undoEverything(limit = UNDO_MAX_STEPS + 5): number {
  let undos = 0;
  while (undos <= limit && undo.undo()) undos++;
  return undos;
}

const SEEDS: PeerStickySeed[] = [
  { text: 'buy milk', x: 0, y: 0, color: 'yellow' },
  { text: 'call the printer', x: 260, y: 40, color: 'green', width: 240, height: 160 },
  { text: 'ship it', x: 520, y: -120, color: 'pink' },
  { text: 'ask about the budget', x: 80, y: 300, color: 'blue', width: 300, height: 200 },
  { text: 'rename "final v3"', x: 400, y: 320, color: 'orange' },
  { text: '🔥 drop the legacy board', x: -300, y: 200, color: 'violet', width: 180, height: 120 },
  { text: 'standup at 10', x: -140, y: -260, color: 'yellow' },
  { text: 'notes from the retro', x: 620, y: 260, color: 'green' },
];

describe('undo.history — only my own changes', () => {
  it('TC-01 undoing my move restores my note and leaves both of my colleague\u2019s changes alone', () => {
    const x = addSticky(peer.doc, { text: 'X', x: 100, y: 100 });
    const z = addSticky(peer.doc, { text: 'Z', x: 400, y: 100, color: 'yellow' });
    const startX = { x: note(x).x, y: note(x).y };

    moveNote(x, startX.x + 600, startX.y + 400);
    expect(undo.canUndo()).toBe(true);
    expect(note(x).x).toBe(startX.x + 600);

    // A colleague arrives after my move and does two things of their own.
    const y = addSticky(peer.doc, { text: 'Y', x: -200, y: 300, color: 'blue' });
    setColor(peer.doc, z, 'green');
    expect(note(z).color).toBe('green');

    expect(undo.undo()).toBe(true);

    // mine is back where it started...
    expect({ x: note(x).x, y: note(x).y }).toEqual(startX);
    // ...and nothing anyone else did was reversed.
    expect(present(y)).toBe(true);
    expect(note(y).text).toBe('Y');
    expect(note(z).color).toBe('green');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-02 a board that only other people have changed has nothing to undo', () => {
    const a = addSticky(peer.doc, { text: 'A', x: 0, y: 0 });
    addSticky(peer.doc, { text: 'B', x: 300, y: 0, color: 'pink' });
    peerMove(peer.doc, a, 900, 900);
    peerRemove(peer.doc, a);
    expect(snapshot(doc)).toHaveLength(1); // their work did land here

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-03 a board loaded from storage is not a change I made', () => {
    const saved = new Y.Doc();
    initDoc(saved);
    addSticky(saved, { text: 'from the store', x: 120, y: 40 });
    addSticky(saved, { text: 'and another', x: 420, y: 260, color: 'orange' });
    addSticky(saved, { text: 'and a third', x: -80, y: 500, color: 'blue' });

    applyWithLoadOrigin(doc, Y.encodeStateAsUpdate(saved));

    expect(snapshot(doc)).toHaveLength(3); // the load itself worked
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    saved.destroy();
  });

  it('TC-04 undoing my delete brings all eight notes back exactly as they were', () => {
    const ids = SEEDS.map((seed) => addSticky(peer.doc, seed));
    const before = boardState();

    step(() => deleteObjects(doc, ids));
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(boardState()).toBe(before);
    expect(snapshot(doc)).toHaveLength(8);
  });

  it('TC-05 redo puts my move back exactly where it was', () => {
    const x = addSticky(peer.doc, { text: 'X', x: 0, y: 0 });
    const start = { x: note(x).x, y: note(x).y };
    const target = { x: start.x + 350, y: start.y - 175 };

    moveNote(x, target.x, target.y);
    expect(undo.undo()).toBe(true);
    expect({ x: note(x).x, y: note(x).y }).toEqual(start);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect({ x: note(x).x, y: note(x).y }).toEqual(target);
    expect(undo.canRedo()).toBe(false);
    expect(undo.canUndo()).toBe(true);
  });

  it('TC-06 a new change of mine throws away what I had undone', () => {
    const a = mySticky('first', 0, 0);
    const b = mySticky('second', 300, 0);

    expect(undo.undo()).toBe(true); // 'second' is gone
    expect(present(b)).toBe(false);
    expect(undo.canRedo()).toBe(true);

    moveNote(a, 50, 50); // a fresh change clears the redo stack

    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(present(b)).toBe(false);
  });

  it('TC-07 undoing the move of a note a colleague deleted does nothing, and nothing throws', () => {
    const x = addSticky(peer.doc, { text: 'X', x: 200, y: 100 });
    const start = { x: note(x).x, y: note(x).y };
    moveNote(x, start.x + 400, start.y + 200);

    peerRemove(peer.doc, x); // my note is gone before I press undo
    expect(present(x)).toBe(false);

    let result: boolean | undefined;
    expect(() => {
      result = undo.undo();
    }).not.toThrow();
    expect(result).toBe(true); // a step was there, and it was consumed
    // Negative scenario: undoing a move must never recreate a deleted object.
    expect(present(x)).toBe(false);
    expect(boardState()).toBe('');

    // The history still works afterwards: my next change undoes as usual.
    const mine = mySticky('afterwards', 0, 0);
    expect(present(mine)).toBe(true);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(present(mine)).toBe(false);
    expect(present(x)).toBe(false);
  });

  it('TC-08 undoing my delete restores the note with what it held when I deleted it', () => {
    const x = addSticky(peer.doc, { text: 'draft', x: 100, y: 100 });
    getStickyText(peer.doc, x)?.insert(0, 'rewritten by a colleague: ');
    expect(note(x).text).toBe('rewritten by a colleague: draft');

    step(() => deleteObjects(doc, [x]));
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).map((n) => n.text)).toEqual(['rewritten by a colleague: draft']);
  });

  it('TC-09 the oldest step is dropped once the history holds UNDO_MAX_STEPS of them', () => {
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(mySticky(`note ${i}`, i * 40, 0));
    }
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    expect(undoEverything()).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);
    expect(present(ids[0]!)).toBe(true); // the first creation was forgotten: it stands
    expect(present(ids[1]!)).toBe(false); // everything from there back is undone
  });

  it('TC-10 a history of exactly UNDO_MAX_STEPS keeps every step', () => {
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      ids.push(mySticky(`note ${i}`, i * 40, 0));
    }
    ids.push(mySticky(`note ${UNDO_MAX_STEPS - 1}`, UNDO_MAX_STEPS * 40, 0));

    expect(undoEverything()).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(0); // nothing was dropped: all of it is undone
  });

  it('TC-11 a fresh controller starts with no history (the history is not persisted)', () => {
    mySticky('before the reload', 0, 0);
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    // What a reload does: the same document, a controller made from scratch.
    const reloaded = createUndo(doc);
    undo = reloaded;
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.canRedo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    expect(reloaded.redo()).toBe(false);
  });
});

describe('undo.history — the rest of the contract', () => {
  it('notifies onChange on a new step and on an undo, and stops when unsubscribed', () => {
    let changes = 0;
    const off = undo.onChange(() => changes++);

    mySticky('typed', 0, 0);
    const afterCreate = changes;
    expect(afterCreate).toBeGreaterThan(0);

    expect(undo.undo()).toBe(true);
    expect(changes).toBeGreaterThan(afterCreate);

    off();
    const afterUnsubscribe = changes;
    mySticky('another', 200, 0);
    expect(changes).toBe(afterUnsubscribe);
  });

  it('boundary() on an empty history is a no-op, and a boundary keeps two actions apart', () => {
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);

    undo.boundary();
    mySticky('one', 0, 0);
    mySticky('two', 200, 0); // mySticky steps for me, so these are two actions
    expect(undoEverything()).toBe(2);
  });

  it('addScope tracks a second type (the hook story 16 uses for comments)', () => {
    const comments = doc.getMap<Y.Map<unknown>>('comments');
    undo.addScope(comments);

    doc.transact(() => {
      const thread = new Y.Map<unknown>();
      thread.set('body', 'looks good to me');
      comments.set('c1', thread);
    }, LOCAL_ORIGIN);

    expect(comments.has('c1')).toBe(true);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(comments.has('c1')).toBe(false);
  });

  it('does not track the schema write, so opening a board is not a step', () => {
    // `initDoc` writes with LOCAL_ORIGIN; it changes `meta`, not `objects`.
    const fresh = new Y.Doc();
    const controller = createUndo(fresh);
    initDoc(fresh);
    expect(controller.canUndo()).toBe(false);
    controller.destroy();
    fresh.destroy();
  });

  it('a change the undo itself applies is never captured as a new step twice over', () => {
    const x = addSticky(peer.doc, { text: 'X', x: 0, y: 0 });
    const start = { x: note(x).x, y: note(x).y };
    moveNote(x, start.x + 100, start.y);

    expect(undo.undo()).toBe(true);
    expect(undo.undo()).toBe(false); // the inverse did not land on the undo stack
    expect(undo.redo()).toBe(true);
    expect({ x: note(x).x, y: note(x).y }).toEqual({ x: start.x + 100, y: start.y });
    expect(undo.canRedo()).toBe(false);
  });
});
