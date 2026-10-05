/**
 * Story 8 unit tests for the per-user undo history (`undo.history`): TC-01 to TC-11,
 * run against real `Y.Doc`s with a real `Y.UndoManager` behind {@link createUndo}.
 *
 * Undo semantics live entirely in the CRDT plus the controller, so nothing is mocked:
 * a second document (see `helpers/peer`) plays the colleague, and its changes cross
 * over with a non-local origin exactly as they would from the network provider. That
 * is what lets these tests prove the personal-scope promise cheaply — undo reverses
 * your own work and leaves everyone else's standing — while the e2e suite proves the
 * same thing over the real socket.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyAsLoad, connectPeer, freshDoc } from './helpers/peer';

/** A document holding `n` notes at distinct positions, plus their ids. */
function board(n: number): { doc: Y.Doc; ids: string[] } {
  const doc = freshDoc();
  const ids: string[] = [];
  for (let index = 0; index < n; index += 1) ids.push(createSticky(doc, { x: index * 400, y: 0 }));
  return { doc, ids };
}

function note(doc: Y.Doc, id: string) {
  const found = snapshot(doc).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
}

function controllerFor(doc: Y.Doc): UndoController {
  return createUndo(doc, { captureTimeoutMs: 0 });
}

describe('undo only my own changes (undo.own)', () => {
  it('TC-01: undoing my move leaves the colleague create and recolour untouched', () => {
    const { doc, ids } = board(2);
    const undo = controllerFor(doc);
    const raj = connectPeer(doc);

    // Mia moves note A.
    moveObjects(doc, new Map([[ids[0]!, { x: 120, y: 60 }]]));

    // Raj creates a note and recolours note B while she is at it.
    const rajNote = raj.createSticky(5000, 5000);
    raj.recolor(ids[1]!, 'blue');
    const blueBefore = note(doc, ids[1]!).color;

    expect(undo.undo()).toBe(true);

    // Mia's own move is reversed back to where the note was created (centred at 0, so x = -100)...
    expect(note(doc, ids[0]!).x).toBeCloseTo(-100, 6);
    expect(note(doc, ids[0]!).y).toBeCloseTo(-100, 6);
    // ...Raj's note is still there...
    expect(snapshot(doc).some((n) => n.id === rajNote)).toBe(true);
    // ...and Raj's colour survives.
    expect(note(doc, ids[1]!).color).toBe(blueBefore);
  });

  it('TC-02: a board only the colleague changed has nothing for me to undo', () => {
    const doc = freshDoc();
    const undo = controllerFor(doc);
    const raj = connectPeer(doc);

    raj.createSticky(100, 100);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('TC-03: a board opened from storage (LOAD origin) is not undoable', () => {
    const source = new Y.Doc();
    initDoc(source);
    createSticky(source, { x: 0, y: 0 });
    createSticky(source, { x: 300, y: 0 });

    const doc = new Y.Doc();
    applyAsLoad(doc, Y.encodeStateAsUpdate(source));

    const undo = controllerFor(doc);
    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});

describe('meaningful steps and redo (undo.redo, undo.steps)', () => {
  it('TC-04: undoing one delete brings all eight notes back whole', () => {
    const { doc, ids } = board(9);
    // Give the first eight text, colour and size so the restore can be checked.
    for (let index = 0; index < 8; index += 1) {
      const id = ids[index]!;
      setStickyColor(doc, id, 'green');
      const text = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      const tr = () => text.insert(0, `note ${index}`);
      doc.transact(tr, LOCAL_ORIGIN);
    }
    moveObjects(doc, new Map([[ids[0]!, { x: 50, y: 55 }]]));

    const undo = controllerFor(doc);
    const cluster = ids.slice(0, 8);
    const before = new Map(cluster.map((id) => [id, note(doc, id)]));

    deleteObjects(doc, cluster);
    expect(snapshot(doc)).toHaveLength(1);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(9);
    for (const id of cluster) {
      const restored = note(doc, id);
      const was = before.get(id)!;
      expect(restored.text).toBe(was.text);
      expect(restored.color).toBe(was.color);
      expect(restored.x).toBeCloseTo(was.x, 6);
      expect(restored.y).toBeCloseTo(was.y, 6);
      expect(restored.width).toBeCloseTo(was.width!, 6);
      expect(restored.height).toBeCloseTo(was.height!, 6);
    }
  });

  it('TC-05: redo re-applies the move I just undid', () => {
    const { doc, ids } = board(1);
    const undo = controllerFor(doc);

    moveObjects(doc, new Map([[ids[0]!, { x: 300, y: 200 }]]));
    expect(undo.undo()).toBe(true);
    expect(note(doc, ids[0]!).x).toBeCloseTo(-100, 6); // created centred at 0 → x = -100

    expect(undo.redo()).toBe(true);
    expect(note(doc, ids[0]!).x).toBeCloseTo(300, 6);
    expect(note(doc, ids[0]!).y).toBeCloseTo(200, 6);
  });

  it('TC-06: a new change after undoing clears the redo stack', () => {
    const { doc, ids } = board(1);
    const undo = controllerFor(doc);

    moveObjects(doc, new Map([[ids[0]!, { x: 400, y: 0 }]]));
    undo.undo();
    expect(undo.canRedo()).toBe(true);

    setStickyColor(doc, ids[0]!, 'pink');
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });
});

describe('undo never breaks on a moving world (undo.safe)', () => {
  it('TC-07: undoing a move of a note a colleague deleted does nothing and stays usable', () => {
    const { doc, ids } = board(2);
    const undo = controllerFor(doc);
    const raj = connectPeer(doc);

    const firstX = note(doc, ids[0]!).x;
    moveObjects(doc, new Map([[ids[0]!, { x: firstX + 150, y: 40 }]]));
    undo.boundary();

    // Raj deletes the note Mia moved.
    raj.change((peer) => deleteObjects(peer, [ids[0]!]));
    expect(snapshot(doc).some((n) => n.id === ids[0]!)).toBe(false);

    // Mia's undo of her own move must not resurrect the note or throw.
    expect(() => undo.undo()).not.toThrow();
    expect(snapshot(doc).some((n) => n.id === ids[0]!)).toBe(false);

    // The rest of the history still works: undo her earlier... there is a second note she
    // can still move and undo.
    moveObjects(doc, new Map([[ids[1]!, { x: note(doc, ids[1]!).x + 10, y: 0 }]]));
    expect(undo.canUndo()).toBe(true);
    expect(() => undo.undo()).not.toThrow();
  });

  it('TC-08: undoing my delete restores the note as it was at the moment I deleted it', () => {
    const { doc, ids } = board(1);
    const id = ids[0]!;
    const undo = controllerFor(doc);
    const raj = connectPeer(doc);

    // Raj types into the note; it reaches Mia before she deletes it.
    raj.change((peer) => {
      const text = (peer.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      peer.transact(() => text.insert(0, 'from raj'), LOCAL_ORIGIN);
    });
    expect(note(doc, id).text).toBe('from raj');

    deleteObjects(doc, [id]);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(note(doc, id).text).toBe('from raj');
  });
});

describe('history length and session scope (undo.limit, undo.session_only)', () => {
  it('TC-09: adding a step past the limit drops the oldest', () => {
    const { doc, ids } = board(1);
    const undo = createUndo(doc, { captureTimeoutMs: 0, maxSteps: UNDO_MAX_STEPS });

    // Create exactly UNDO_MAX_STEPS distinct steps, each closed by a boundary.
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      moveObjects(doc, new Map([[ids[0]!, { x: index, y: 0 }]]));
      undo.boundary();
    }
    // One more step pushes it over; the oldest is dropped so length stays at the limit.
    moveObjects(doc, new Map([[ids[0]!, { x: UNDO_MAX_STEPS, y: 0 }]]));
    undo.boundary();

    expect(undo.canUndo()).toBe(true);
    // The history is capped: undoing the whole way must leave the very first position
    // (x = -100 from creation) unreachable because the oldest step was dropped, so the
    // note ends somewhere past it.
    let steps = 0;
    while (undo.undo()) steps += 1;
    expect(steps).toBeLessThanOrEqual(UNDO_MAX_STEPS);
    expect(note(doc, ids[0]!).x).toBeGreaterThan(-100);
  });

  it('TC-10: reaching exactly the limit drops nothing', () => {
    const { doc, ids } = board(1);
    const undo = createUndo(doc, { captureTimeoutMs: 0, maxSteps: UNDO_MAX_STEPS });

    // UNDO_MAX_STEPS - 1 steps, then one more to land exactly on the limit.
    for (let index = 0; index < UNDO_MAX_STEPS - 1; index += 1) {
      moveObjects(doc, new Map([[ids[0]!, { x: index, y: 0 }]]));
      undo.boundary();
    }
    moveObjects(doc, new Map([[ids[0]!, { x: UNDO_MAX_STEPS - 1, y: 0 }]]));
    undo.boundary();

    let steps = 0;
    while (undo.undo()) steps += 1;
    // Every step survived, so the note walks all the way back to where it was created.
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(note(doc, ids[0]!).x).toBeCloseTo(-100, 6);
  });

  it('TC-11: a fresh controller after a reload has nothing to undo', () => {
    const { doc, ids } = board(1);
    const first = createUndo(doc, { captureTimeoutMs: 0 });
    moveObjects(doc, new Map([[ids[0]!, { x: 250, y: 0 }]]));
    expect(first.canUndo()).toBe(true);

    first.destroy();
    const reloaded = createUndo(doc, { captureTimeoutMs: 0 });
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
  });
});
