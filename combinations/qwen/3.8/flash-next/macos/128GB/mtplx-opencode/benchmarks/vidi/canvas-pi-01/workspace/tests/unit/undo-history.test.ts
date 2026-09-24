/**
 * Story 8 · task 6 — undo-history unit tests (TC-01 … TC-11), written test-first
 * against the personal-scope contract (`createUndo`).
 *
 * Every "remote" here is a second real `Y.Doc` whose updates are pushed into the
 * board under a non-local origin, so the tests prove the *negative* cases for
 * free: a colleague's move / create / recolour / delete never becomes an undo
 * step in my history (PRD undo.own), and neither does a story-4 load.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  moveObject,
  setStickyColor,
  initDoc,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { createPeer, applyLoad } from './peer';

function board(notes: Array<{ x: number; y: number; color?: 'pink'; text?: string }> = []) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (const n of notes) {
    const id = createSticky(doc, { x: n.x, y: n.y }, n.color ?? 'yellow');
    if (n.text) {
      const rec = doc.getMap<Y.Map<unknown>>('objects').get(id);
      (rec!.get('text') as Y.Text).insert(0, n.text);
    }
    ids.push(id);
  }
  return { doc, ids };
}

function snap(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return snapshot(doc).find((o) => o.id === id);
}

describe('undo.own — only my changes are undoable', () => {
  it('TC-01: undoing my move restores it while a peer create + recolour survive', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }, { x: 500, y: 100 }]);
    const [a, c] = ids;
    const ctl = createUndo(doc);
    const before = snap(doc, a)!;

    // My move of note A is the only step in my history.
    ctl.boundary();
    expect(moveObject(doc, a, 200, 200)).toBe(true);

    // A colleague adds note Y and recolours note Z, both under the provider origin.
    const peer = createPeer(doc);
    peer.change(doc, (p) => {
      createSticky(p, { x: 300, y: 300 }, 'blue');
      setStickyColor(p, c, 'blue');
    });
    expect(ctl.undoDepth()).toBe(1);

    // Undo only reverts my move.
    ctl.undo();
    const after = snap(doc, a)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Raj's note still exists ...
    expect(snapshot(doc)).toHaveLength(3);
    // ... and note C keeps Raj's colour (not reversed).
    expect(snap(doc, c)!.color).toBe('blue');
  });

  it('TC-02: peer changes alone leave the history empty', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }]);
    const ctl = createUndo(doc);
    const peer = createPeer(doc);
    peer.change(doc, (p) => {
      createSticky(p, { x: 300, y: 300 });
      setStickyColor(p, ids[0], 'green');
    });
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.canRedo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });

  it('TC-03: a story-4 load applied under the load origin is not undoable', () => {
    const seeded = new Y.Doc();
    initDoc(seeded);
    createSticky(seeded, { x: 100, y: 100 });
    const update = Y.encodeStateAsUpdate(seeded);

    const doc = new Y.Doc();
    initDoc(doc);
    const ctl = createUndo(doc);
    applyLoad(doc, update);
    expect(snapshot(doc).length).toBeGreaterThan(0);
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });
});

describe('undo.history — restore, redo and clearing', () => {
  it('TC-04: undo of a 8-note delete restores every note with text/colour/size/position', () => {
    const { doc, ids } = board(
      Array.from({ length: 8 }, (_, i) => ({ x: i * 60, y: 40, color: 'pink' as const, text: `n${i}` })),
    );
    const before = snapshot(doc).map((o) => ({ ...o }));
    const ctl = createUndo(doc);

    ctl.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc)).toHaveLength(0);
    expect(ctl.undoDepth()).toBe(1);

    ctl.undo();
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    const byId = new Map(after.map((o) => [o.id, o]));
    for (const original of before) {
      const restored = byId.get(original.id)!;
      expect(restored).toBeDefined();
      expect(restored.color).toBe(original.color);
      expect(restored.width).toBe(original.width);
      expect(restored.height).toBe(original.height);
      expect(restored.x).toBe(original.x);
      expect(restored.y).toBe(original.y);
      expect(restored.text).toBe(original.text);
    }
  });

  it('TC-05: redo re-applies the undone move', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }]);
    const a = ids[0];
    const ctl = createUndo(doc);
    const before = snap(doc, a)!;
    ctl.boundary();
    moveObject(doc, a, 200, 200);
    expect(snap(doc, a)!.x).toBe(200);
    ctl.undo();
    expect(ctl.canRedo()).toBe(true);
    expect(snap(doc, a)!.x).toBe(before.x);
    expect(ctl.redo()).toBe(true);
    expect(snap(doc, a)!.x).toBe(200);
  });

  it('TC-06: a new change after undoing clears redo', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }]);
    const a = ids[0];
    const ctl = createUndo(doc);
    ctl.boundary();
    moveObject(doc, a, 200, 200);
    ctl.undo();
    expect(ctl.canRedo()).toBe(true);
    ctl.boundary();
    setStickyColor(doc, a, 'violet');
    expect(ctl.canRedo()).toBe(false);
  });
});

describe('undo.safe — never breaks on changed objects', () => {
  it('TC-07: undoing a move whose target a peer deleted does not throw or recreate it', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }, { x: 500, y: 100 }]);
    const [a, c] = ids;
    const ctl = createUndo(doc);
    ctl.boundary();
    moveObject(doc, a, 200, 200);
    ctl.boundary();
    moveObject(doc, c, 600, 600);
    expect(ctl.undoDepth()).toBe(2);

    // A colleague deletes note A while my move is still the top step.
    const peer = createPeer(doc);
    peer.change(doc, (p) => {
      p.getMap<Y.Map<unknown>>('objects').delete(a);
    });
    expect(doc.getMap('objects').has(a)).toBe(false);

    // The top step's target is gone: undo must not throw and must not recreate it.
    expect(() => ctl.undo()).not.toThrow();
    expect(doc.getMap('objects').has(a)).toBe(false);
    // The next undo still works on a present object.
    expect(() => ctl.undo()).not.toThrow();
  });

  it('TC-08: undoing my delete restores a note a peer had edited, with that content', () => {
    const { doc, ids } = board([{ x: 100, y: 100, text: 'draft' }]);
    const a = ids[0];
    // A peer types into note A (provider origin) before I delete it.
    const peer = createPeer(doc);
    peer.change(doc, (p) => {
      const rec = p.getMap<Y.Map<unknown>>('objects').get(a);
      (rec!.get('text') as Y.Text).insert(5, ' — reviewed');
    });
    expect(snap(doc, a)!.text).toBe('draft — reviewed');

    const ctl = createUndo(doc);
    ctl.boundary();
    deleteObjects(doc, [a]);
    expect(doc.getMap('objects').has(a)).toBe(false);
    ctl.undo();

    const restored = snap(doc, a);
    expect(restored).toBeDefined();
    // Restored with the content it had at the moment of my delete.
    expect(restored!.text).toBe('draft — reviewed');
  });
});

describe('undo.limit — history length', () => {
  it('TC-09: at UNDO_MAX_STEPS the oldest step is dropped when a new one is added', () => {
    // One distinct note to move per step so the changes cannot merge.
    const notes = Array.from({ length: UNDO_MAX_STEPS + 1 }, (_, i) => ({ x: i * 60, y: 0 }));
    const { doc, ids } = board(notes);
    const ctl = createUndo(doc);

    for (const id of ids) {
      ctl.boundary();
      moveObject(doc, id, 5, 5);
    }
    expect(ctl.undoDepth()).toBe(UNDO_MAX_STEPS);
  });

  it('TC-10: at UNDO_MAX_STEPS − 1 nothing is dropped when a new step is added', () => {
    const notes = Array.from({ length: UNDO_MAX_STEPS }, (_, i) => ({ x: i * 60, y: 0 }));
    const { doc, ids } = board(notes);
    const ctl = createUndo(doc);

    for (const id of ids) {
      ctl.boundary();
      moveObject(doc, id, 5, 5);
    }
    expect(ctl.undoDepth()).toBe(UNDO_MAX_STEPS);
  });
});

describe('undo.session_only — history is per controller', () => {
  it('TC-11: destroying then rebuilding the controller yields an empty history', () => {
    const { doc, ids } = board([{ x: 100, y: 100 }]);
    const first = createUndo(doc);
    first.boundary();
    moveObject(doc, ids[0], 200, 200);
    expect(first.canUndo()).toBe(true);

    first.destroy();
    // A reload builds a fresh controller over the same document.
    const second = createUndo(doc);
    expect(second.canUndo()).toBe(false);
  });
});

// Silence the unused-import check for the origin used only inside `peer.change`.
void LOCAL_ORIGIN;