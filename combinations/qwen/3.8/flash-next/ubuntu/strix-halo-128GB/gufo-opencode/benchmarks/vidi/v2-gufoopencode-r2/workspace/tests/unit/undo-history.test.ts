// Task 6 (story 8): unit suite for the undo.history contract — TC-01 to TC-11.
// Real Y.Docs; the simulated remote peer from ./peer.ts keeps remote and load
// origins untracked exactly like the provider and the story 4 loader.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyLoadUpdate, connectPeer, type Peer } from './peer';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function note(doc: Y.Doc, id: string): StickySnapshot {
  const found = snapshot(doc).find((n) => n.id === id);
  if (!found) throw new Error(`note ${id} absent`);
  return found;
}

function hasNote(doc: Y.Doc, id: string): boolean {
  return snapshot(doc).some((n) => n.id === id);
}

// Fixtures must be written before the controller exists so they never enter
// the undo stacks.
function startUndo(doc: Y.Doc): { undo: UndoController; peer: Peer } {
  const undo = createUndo(doc);
  const peer = connectPeer(doc);
  return { undo, peer };
}

// TC-01: local move undone; remote creations and recolours untouched.
describe('TC-01 (undo.own)', () => {
  it('undoes only the local move, leaving peer changes in place', () => {
    const doc = newDoc();
    const x = createSticky(doc, { x: 100, y: 100 }) as string;
    const z = createSticky(doc, { x: 500, y: 100 }) as string;
    const { undo, peer } = startUndo(doc);

    moveObject(doc, x, 300, 400);
    expect(note(doc, x).x).toBe(300); // moveObject writes the top-left corner
    setStickyColor(peer.doc, z, 'blue');
    const y = createSticky(peer.doc, { x: 900, y: 900 }) as string;

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    expect(note(doc, x).x).toBe(0); // back at the fixture position
    expect(note(doc, x).y).toBe(0);
    expect(hasNote(doc, y)).toBe(true); // peer note still present
    expect(note(doc, z).color).toBe('blue'); // peer colour kept
    peer.dispose();
  });
});

// TC-02: remote changes are never captured.
describe('TC-02 (undo.own negative)', () => {
  it('canUndo stays false when only the peer changed', () => {
    const doc = newDoc();
    const { undo, peer } = startUndo(doc);
    createSticky(peer.doc, { x: 100, y: 100 });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false); // error path: empty stack returns false
    peer.dispose();
  });
});

// TC-03: story 4 load-origin updates are never captured.
describe('TC-03 (undo.own negative)', () => {
  it('canUndo stays false for LOAD-origin updates', () => {
    const source = newDoc();
    createSticky(source, { x: 100, y: 100 });
    createSticky(source, { x: 400, y: 100 });
    const update = Y.encodeStateAsUpdate(source);

    const doc = new Y.Doc();
    const { undo } = startUndo(doc);
    applyLoadUpdate(doc, update);

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
  });
});

// TC-04: undoing my delete restores everything as it was.
describe('TC-04 (undo.safe, target present)', () => {
  it('restores 8 deleted notes with text, colour, size and position', () => {
    const doc = newDoc();
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = createSticky(doc, { x: i * 300, y: 0 }, colors[i]) as string;
      getStickyText(doc, id)?.insert(0, `note ${i}`);
      resizeObjects(doc, new Map([[id, { x: i * 300 - 100, y: -100, width: 120 + i, height: 90 + i }]]));
      ids.push(id);
    }
    const { undo } = startUndo(doc);
    const before = snapshot(doc);

    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toEqual(before);
  });
});

// TC-05: redo re-applies; onChange fires on every stack change.
describe('TC-05 (undo.redo)', () => {
  it('undo then redo re-applies the move, notifying listeners', () => {
    const doc = newDoc();
    const x = createSticky(doc, { x: 100, y: 100 }) as string;
    const { undo } = startUndo(doc);

    const seen: string[] = [];
    const unsubscribe = undo.onChange(() => seen.push('change'));

    moveObject(doc, x, 300, 300);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(note(doc, x).x).toBe(0);
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(doc, x).x).toBe(300);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    unsubscribe();
    const count = seen.length;
    moveObject(doc, x, 50, 50);
    expect(seen).toHaveLength(count); // unsubscribed
  });
});

// TC-06: a new local change clears the redo stack.
describe('TC-06 (undo.redo_cleared)', () => {
  it('canRedo is false after a new change follows an undo', () => {
    const doc = newDoc();
    const x = createSticky(doc, { x: 100, y: 100 }) as string;
    const { undo } = startUndo(doc);

    setStickyColor(doc, x, 'blue');
    expect(undo.undo()).toBe(true);
    expect(note(doc, x).color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    setStickyColor(doc, x, 'green'); // new step clears redo
    expect(undo.canRedo()).toBe(false);
  });
});

// TC-07 (error path): inverse targets an item deleted remotely.
describe('TC-07 (undo.safe, deleted remotely)', () => {
  it('undo of a move whose object was deleted remotely has no effect', () => {
    const doc = newDoc();
    const x = createSticky(doc, { x: 100, y: 100 }) as string;
    const other = createSticky(doc, { x: 800, y: 100 }) as string;
    const { undo, peer } = startUndo(doc);

    moveObject(doc, x, 400, 400);
    deleteObjects(peer.doc, [x]); // remote delete wins
    expect(hasNote(doc, x)).toBe(false);

    expect(() => undo.undo()).not.toThrow();
    expect(hasNote(doc, x)).toBe(false); // not resurrected

    // The next undo still works.
    moveObject(doc, other, 1000, 1000);
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(note(doc, other).x).toBe(700);
    peer.dispose();
  });
});

// TC-08: my delete undo restores content as of the delete, peer edit included.
describe('TC-08 (undo.safe, edited remotely before my delete)', () => {
  it('restores the note with the remote text that existed at delete time', () => {
    const doc = newDoc();
    const x = createSticky(doc, { x: 100, y: 100 }) as string;
    const { undo, peer } = startUndo(doc);

    getStickyText(peer.doc, x)?.insert(0, 'theirs '); // remote edit syncs in
    expect(note(doc, x).text).toBe('theirs ');

    deleteObjects(doc, [x]);
    expect(undo.undo()).toBe(true);
    expect(note(doc, x).text).toBe('theirs '); // content at time of delete
    peer.dispose();
  });
});

// TC-09 (boundary UNDO_MAX_STEPS): the undo stack is trimmed from the front.
describe('TC-09 (undo.limit at UNDO_MAX_STEPS)', () => {
  it('adding one step beyond UNDO_MAX_STEPS drops the oldest', () => {
    const doc = newDoc();
    const { undo } = startUndo(doc);
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i += 1) {
      createSticky(doc, { x: i * 300, y: 0 });
      undo.boundary();
    }
    let undone = 0;
    while (undo.undo() && undone < UNDO_MAX_STEPS + 5) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS); // the oldest step was dropped
    expect(snapshot(doc)).toHaveLength(1); // only the first note survived
  });
});

// TC-10 (boundary UNDO_MAX_STEPS − 1): exactly at the limit, nothing dropped.
describe('TC-10 (undo.limit at UNDO_MAX_STEPS − 1)', () => {
  it('adding the UNDO_MAX_STEPS-th step drops nothing', () => {
    const doc = newDoc();
    const { undo } = startUndo(doc);
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i += 1) {
      createSticky(doc, { x: i * 300, y: 0 });
      undo.boundary();
    }
    createSticky(doc, { x: UNDO_MAX_STEPS * 300, y: 0 }); // step 200
    undo.boundary();
    let undone = 0;
    while (undo.undo() && undone < UNDO_MAX_STEPS + 5) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

// TC-11 (undo.session_only): history lives only in this controller.
describe('TC-11 (undo.session_only)', () => {
  it('a fresh controller after destroy starts empty', () => {
    const doc = newDoc();
    const { undo } = startUndo(doc);
    createSticky(doc, { x: 100, y: 100 });
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.undo()).toBe(false);
  });
});

// Contract coverage beyond the TC matrix: addScope (story 16 hook) and the
// onChange subscription shape.
describe('undo contract: addScope and onChange', () => {
  it('changes outside the objects scope are ignored until addScope', () => {
    const doc = newDoc();
    const { undo } = startUndo(doc);

    const other = doc.getMap('other');
    doc.transact(() => other.set('a', 1), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(false); // out of scope

    undo.addScope(other);
    doc.transact(() => other.set('b', 2), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(other.get('b')).toBeUndefined();
  });
});
