/**
 * Story 8 unit tests (undo.history, TC-01 to TC-11).
 *
 * Real Y.Docs throughout: the behaviour under test is the Y.UndoManager plus
 * the UndoController wrapper. A simulated remote peer (second real Y.Doc,
 * non-local origin) and a story 4 LOAD-origin helper prove that only this
 * tab's own LOCAL_ORIGIN transactions enter the history.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { Peer, applyLoad, seedSticky } from './peer';

const pos = (doc: Y.Doc, id: string) => {
  const o = snapshot(doc).find((s) => s.id === id);
  if (!o) throw new Error(`object ${id} missing`);
  return o;
};

describe('undo.history', () => {
  it('TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const x = seedSticky(doc, { x: 0, y: 0 }, { color: 'yellow' });
    c.boundary();
    const z = seedSticky(doc, { x: 600, y: 0 }, { color: 'yellow' });
    c.boundary();
    const peer = new Peer(doc);
    // Mia moves X.
    moveObject(doc, x, 100, 50);
    c.boundary();
    // Raj creates Y and recolours Z (remote, non-local origin).
    peer.change((d) => {
      createSticky(d, { x: 300, y: 0 }, 'green');
      setStickyColor(d, z, 'blue');
    });

    expect(c.canUndo()).toBe(true);
    expect(c.undo()).toBe(true);

    // X is back where it was.
    expect(pos(doc, x).x).toBe(0);
    expect(pos(doc, x).y).toBe(0);
    // Y still exists (Raj's create was not reversed).
    const y = snapshot(doc).find((o) => o.id !== x && o.id !== z);
    expect(y).toBeDefined();
    // Z keeps Raj's colour (Raj's recolor was not reversed).
    expect(pos(doc, z).color).toBe('blue');
  });

  it('TC-02: only peer changes → canUndo false (undo/redo return false)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = new Peer(doc);
    peer.change((d) => {
      createSticky(d, { x: 0, y: 0 }, 'pink');
    });
    expect(snapshot(doc).length).toBe(1); // the change did land
    expect(c.canUndo()).toBe(false);
    expect(c.undo()).toBe(false);
    expect(c.redo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates → canUndo false', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    applyLoad(doc, (d) => {
      createSticky(d, { x: 0, y: 0 }, 'orange');
    });
    expect(snapshot(doc).length).toBe(1); // the change did land
    expect(c.canUndo()).toBe(false);
    expect(c.undo()).toBe(false);
  });

  it('TC-04: delete 8 notes, undo → all 8 restored with text, colour, size, position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const ids: string[] = [];
    const original: Record<string, { x: number; y: number; width: number; height: number; color: StickyColor; text: string }> = {};
    for (let i = 0; i < 8; i++) {
      const o = {
        x: i * 300,
        y: 0,
        width: 120 + i * 10,
        height: 140 + i * 5,
        color: colors[i % colors.length],
        text: `note ${i}`,
      };
      const id = seedSticky(doc, { x: o.x, y: o.y }, o);
      original[id] = o;
      ids.push(id);
      c.boundary();
    }

    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc).length).toBe(0);
    c.boundary();

    expect(c.undo()).toBe(true);
    for (const id of ids) {
      const o = pos(doc, id);
      expect(o.x).toBe(original[id].x);
      expect(o.y).toBe(original[id].y);
      expect(o.width).toBe(original[id].width);
      expect(o.height).toBe(original[id].height);
      expect(o.color).toBe(original[id].color);
      expect(o.text).toBe(original[id].text);
    }
  });

  it('TC-05: undo then redo → position re-applied', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const x = seedSticky(doc, { x: 10, y: 20 });
    c.boundary();
    expect(moveObject(doc, x, 110, 220)).toBe(true);
    c.boundary();

    expect(c.undo()).toBe(true);
    expect(pos(doc, x).x).toBe(10);
    expect(pos(doc, x).y).toBe(20);

    expect(c.redo()).toBe(true);
    expect(pos(doc, x).x).toBe(110);
    expect(pos(doc, x).y).toBe(220);
    expect(c.canRedo()).toBe(false);
  });

  it('TC-06: undo, then a new change → canRedo false (redo cleared)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const x = seedSticky(doc, { x: 0, y: 0 }, { color: 'yellow' });
    c.boundary();
    expect(setStickyColor(doc, x, 'blue')).toBe(true);
    c.boundary();

    expect(c.undo()).toBe(true);
    expect(pos(doc, x).color).toBe('yellow');
    expect(c.canRedo()).toBe(true);

    // A new local change clears the redo stack.
    expect(moveObject(doc, x, 5, 5)).toBe(true);
    c.boundary();
    expect(c.canRedo()).toBe(false);
    expect(c.canUndo()).toBe(true);
  });

  it('TC-07: undo a move of an object deleted remotely → no throw, stays deleted, next undo works', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const a = seedSticky(doc, { x: 0, y: 0 });
    c.boundary();
    const b = seedSticky(doc, { x: 400, y: 0 });
    c.boundary();
    const peer = new Peer(doc);
    moveObject(doc, a, 50, 0);
    c.boundary();
    moveObject(doc, b, 50, 0);
    c.boundary();
    // Raj deletes A while Mia's history holds both moves.
    peer.change((d) => {
      deleteObjects(d, [a]);
    });
    expect(doc.getMap('objects').has(a)).toBe(false);

    // Undo #1: B's move — B returns to its start.
    expect(() => c.undo()).not.toThrow();
    expect(pos(doc, b).x).toBe(400);
    // Undo #2: A's move — A is gone; no throw, nothing recreated, step consumed.
    expect(() => c.undo()).not.toThrow();
    expect(doc.getMap('objects').has(a)).toBe(false);
    // The rest of the history stays usable.
    expect(moveObject(doc, b, 60, 0)).toBe(true);
    c.boundary();
    expect(c.undo()).toBe(true);
    expect(pos(doc, b).x).toBe(400);
  });

  it('TC-08: peer edits text, then my delete; undo → restored with content at time of delete', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const x = seedSticky(doc, { x: 0, y: 0 }, { text: 'old' });
    c.boundary();
    const peer = new Peer(doc);
    peer.change((d) => {
      getStickyText(d, x)?.insert(0, 'hi');
    });
    expect(getStickyText(doc, x)?.toString()).toBe('hiold');

    expect(deleteObjects(doc, [x])).toBe(1);
    c.boundary();

    expect(c.undo()).toBe(true);
    // Back with its content as of my delete (including the peer's earlier edit).
    expect(getStickyText(doc, x)?.toString()).toBe('hiold');
    expect(pos(doc, x).x).toBe(0);
  });

  it(`TC-09: ${UNDO_MAX_STEPS} steps + 1 → length stays ${UNDO_MAX_STEPS}, oldest dropped`, () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i <= UNDO_MAX_STEPS; i++) {
      const id = seedSticky(doc, { x: i * 10, y: 0 });
      ids.push(id);
      c.boundary();
    }

    let undone = 0;
    while (c.undo()) undone++;
    expect(undone).toBe(UNDO_MAX_STEPS);
    // The oldest step (note 0's create) was trimmed: note 0 survives.
    expect(doc.getMap('objects').has(ids[0])).toBe(true);
    for (let i = 1; i <= UNDO_MAX_STEPS; i++) {
      expect(doc.getMap('objects').has(ids[i])).toBe(false);
    }
  });

  it(`TC-10: ${UNDO_MAX_STEPS - 1} + 1 steps → length ${UNDO_MAX_STEPS}, nothing dropped`, () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      const id = seedSticky(doc, { x: i * 10, y: 0 });
      ids.push(id);
      c.boundary();
    }

    let undone = 0;
    while (c.undo()) undone++;
    expect(undone).toBe(UNDO_MAX_STEPS);
    for (const id of ids) {
      expect(doc.getMap('objects').has(id)).toBe(false);
    }
  });

  it('TC-11: destroy then a fresh controller → canUndo false (history is session only)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    seedSticky(doc, { x: 0, y: 0 });
    c.boundary();
    expect(c.canUndo()).toBe(true);

    c.destroy();
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    fresh.destroy();
  });
});
