/**
 * Story 8 unit tests — the undo/redo engine, driven directly.
 *
 * The controller is created over a real `Y.Doc`, remote work is applied through
 * a second document with a non-local origin, and each step under test is closed
 * with `boundary()` exactly as the product does around a command — so these
 * check ownership, steps, restore contents, the 200-step limit and safety, with
 * no browser and no network.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  moveObject,
  objectSnapshots,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { changeAsLoad, changeAsPeer } from './helpers/peer';

let doc: Y.Doc;
let undo: UndoController;

beforeEach(() => {
  doc = new Y.Doc();
  undo = createUndo(doc);
});

function note(id: string): StickySnapshot | undefined {
  return (snapshot(doc) as StickySnapshot[]).find((n) => n.id === id);
}

/** Write a note's text directly (the way the editor does, via its Y.Text). */
function writeText(target: Y.Doc, id: string, text: string): void {
  getStickyText(target, id)?.insert(0, text);
}

describe('undo ownership (undo.own, undo.empty, undo.not_tracked)', () => {
  it('TC-01: undoes my move while a peer keeps their own create and recolour', () => {
    const x = createSticky(doc, { x: 0, y: 0 });
    const z = createSticky(doc, { x: 400, y: 0 });
    const before = { x: note(x)!.x, y: note(x)!.y };
    undo.boundary();

    moveObject(doc, x, 90, 45);
    undo.boundary();

    // A colleague creates a note and recolours Z; none of it is captured here.
    changeAsPeer(doc, (peer) => {
      createSticky(peer, { x: 800, y: 800 });
      setStickyColor(peer, z, 'orange');
    });

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    expect(note(x)).toMatchObject({ x: before.x, y: before.y }); // my move reversed
    expect(note(z)?.color).toBe('orange'); // their recolour stands
    // The peer's created note is still present after the undo.
    expect(objectSnapshots(doc).length).toBe(3);
  });

  it('TC-02: a change made only by a peer leaves nothing to undo', () => {
    changeAsPeer(doc, (peer) => {
      createSticky(peer, { x: 10, y: 10 });
    });
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-03: board-load updates are not undoable', () => {
    changeAsLoad(doc, (source) => {
      createSticky(source, { x: 5, y: 5 });
      createSticky(source, { x: 25, y: 5 });
    });
    expect(objectSnapshots(doc).length).toBe(2);
    expect(undo.canUndo()).toBe(false);
  });
});

describe('undo steps and contents (undo.steps, undo.redo, undo.safe)', () => {
  it('TC-04: one undo restores a batch delete with text, colour, size and position', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) ids.push(createSticky(doc, { x: i * 100, y: i * 50 }));
    ids.forEach((id, i) => {
      writeText(doc, id, `note ${i}`);
      setStickyColor(doc, id, i % 2 === 0 ? 'yellow' : 'violet');
      resizeObjects(doc, new Map([[id, { x: i * 100, y: i * 50, width: 160 + i, height: 120 + i }]]));
    });
    const expected = ids.map((id, i) => {
      const n = note(id)!;
      return { x: n.x, y: n.y, width: n.width, height: n.height, text: `note ${i}`, color: n.color };
    });
    undo.boundary();
    deleteObjects(doc, ids);
    undo.boundary();

    expect(objectSnapshots(doc).length).toBe(0);
    expect(undo.undo()).toBe(true);

    expect((snapshot(doc) as StickySnapshot[]).length).toBe(8);
    ids.forEach((id, i) => {
      expect(note(id)).toMatchObject(expected[i]);
    });
  });

  it('TC-05: redo re-applies the change the undo reversed', () => {
    const x = createSticky(doc, { x: 0, y: 0 });
    const before = { x: note(x)!.x, y: note(x)!.y };
    undo.boundary();
    moveObject(doc, x, 120, 60);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(note(x)).toMatchObject({ x: before.x, y: before.y });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(note(x)).toMatchObject({ x: 120, y: 60 });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06: a new change after an undo discards the redo branch', () => {
    const x = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, x, 120, 60);
    undo.boundary();

    undo.undo();
    expect(undo.canRedo()).toBe(true);

    expect(setStickyColor(doc, x, 'green')).toBe(true);
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07: undoing a change to an object a peer deleted is not an error', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, a, 10, 10);
    undo.boundary();
    moveObject(doc, a, 20, 20);
    undo.boundary();

    // The peer deletes the object my queued steps refer to.
    changeAsPeer(doc, (peer) => deleteObjects(peer, [a]));

    expect(() => undo.undo()).not.toThrow();
    expect(note(a)).toBeUndefined(); // my undo does not resurrect what they deleted
    expect(() => undo.undo()).not.toThrow(); // the history stays callable
    expect(() => undo.redo()).not.toThrow();
  });

  it('TC-08: undo restores the content of a deleted note as it was at delete', () => {
    const a = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    // A peer types into my note while it exists.
    changeAsPeer(doc, (peer) => writeText(peer, a, 'their words'));
    expect(note(a)?.text).toBe('their words');

    deleteObjects(doc, [a]);
    undo.boundary();
    expect(objectSnapshots(doc).length).toBe(0);

    expect(undo.undo()).toBe(true);
    expect(note(a)?.text).toBe('their words'); // content at the moment of delete
  });
});

describe('undo history limit (undo.limit)', () => {
  /** Create `n` notes, each its own undo step. */
  function createMany(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      ids.push(createSticky(doc, { x: i, y: 0 }));
      undo.boundary();
    }
    return ids;
  }

  it('TC-09: the oldest step falls off past 200, and its object survives', () => {
    const ids = createMany(UNDO_MAX_STEPS + 1); // 201 steps
    let undone = 0;
    while (undo.undo()) undone += 1;

    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(note(ids[0])).toBeDefined(); // oldest create was never on the stack
    expect(objectSnapshots(doc).length).toBe(1);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-10: exactly 200 steps are all undoable and nothing is dropped', () => {
    const ids = createMany(UNDO_MAX_STEPS); // 200 steps
    let undone = 0;
    while (undo.undo()) undone += 1;

    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(objectSnapshots(doc).length).toBe(0);
    expect(note(ids[0])).toBeUndefined();
  });
});

describe('undo session lifetime (undo.session_only)', () => {
  it('TC-11: destroying and recreating the controller starts an empty history', () => {
    createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const fresh = createUndo(doc);
    try {
      expect(fresh.canUndo()).toBe(false);
      expect(fresh.canRedo()).toBe(false);
    } finally {
      fresh.destroy();
    }
  });
});
