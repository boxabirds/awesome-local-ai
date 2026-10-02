/**
 * Story 8 — per-client undo history semantics (unit, PRD undo.history,
 * undo.isolation, undo.sync_independence, undo.empty).
 *
 * Runs directly against a local `Y.Doc` + `createUndo` (no network). Peer
 * changes arrive through `tests/unit/peer.ts` with a non-local origin, and a
 * full-board load arrives with `LOAD_ORIGIN` — both must be invisible to the
 * local history.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  deleteObjects,
  setStickyColor,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createPeer, applyLoad } from './peer';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

function boundsOf(doc: Y.Doc, id: string) {
  const s = snapshot(doc).find((n) => n.id === id);
  if (!s) return undefined;
  return { x: s.x, y: s.y };
}

describe('story 8 — per-client undo history (unit)', () => {
  it('TC-01: undo restores my move; peer-created note and peer colour stay', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 100, y: 100 }, 'yellow') as string;
    const z = createSticky(doc, { x: 500, y: 100 }, 'blue') as string;
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    // My move (tracked).
    moveObject(doc, a, 300, 400);

    // Peer work (untracked): creates a note and recolors mine.
    const y = createSticky(peer.doc, { x: 900, y: 100 }, 'green') as string;
    setStickyColor(peer.doc, z, 'pink');

    expect(undo.canUndo()).toBe(true);
    undo.undo();

    const snaps = snapshot(doc);
    expect(boundsOf(doc, a)).toEqual({ x: 0, y: 0 }); // back to the original top-left
    expect(snaps.some((n) => n.id === y)).toBe(true); // peer's note survived
    expect(snaps.find((n) => n.id === z)?.color).toBe('pink'); // peer's colour survived
    peer.destroy();
  });

  it('TC-02: peer-only changes are not tracked; canUndo stays false', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    const y = createSticky(peer.doc, { x: 100, y: 100 }, 'green') as string;

    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    // The peer's note is visible locally but not in my history.
    expect(snapshot(doc).some((n) => n.id === y)).toBe(true);
    peer.destroy();
  });

  it('TC-03: a full-board load (non-local origin) is not tracked', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);

    const source = freshDoc();
    createSticky(source, { x: 100, y: 100 });
    createSticky(source, { x: 400, y: 100 });
    applyLoad(doc, source);

    expect(undo.canUndo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
  });

  it('TC-04: delete eight notes, undo restores all with text, colour, size and position', () => {
    const doc = freshDoc();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = createSticky(doc, { x: 300 + i * 300, y: 200 }, COLORS[i % 6]) as string;
      getStickyText(doc, id)?.insert(0, `note ${i}`);
      // Give each note a distinct explicit size (story 7 resize fields).
      doc.transact(() => {
        const m = doc.getMap('objects').get(id);
        if (m instanceof Y.Map) {
          m.set('width', 220 + i * 10);
          m.set('height', 210 + i * 10);
        }
      });
      ids.push(id);
    }
    const before = snapshot(doc);
    expect(before).toHaveLength(8);

    const undo = createUndo(doc);
    deleteObjects(doc, ids);
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(true);

    undo.undo();
    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      const a = after.find((n) => n.id === b.id);
      expect(a, `note ${b.id} restored with identical fields`).toEqual(b);
    }
  });

  it('TC-05: undo then redo re-applies the change', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 200, y: 200 }) as string;
    const undo = createUndo(doc);

    moveObject(doc, a, 350, 260);
    undo.undo();
    expect(boundsOf(doc, a)).toEqual({ x: 100, y: 100 });
    expect(undo.canRedo()).toBe(true);

    undo.redo();
    expect(boundsOf(doc, a)).toEqual({ x: 350, y: 260 });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06: a new local change after undo clears the redo history', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 200, y: 200 }) as string;
    const undo = createUndo(doc);

    moveObject(doc, a, 300, 300);
    undo.boundary();
    setStickyColor(doc, a, 'pink');
    expect(snapshot(doc).find((n) => n.id === a)?.color).toBe('pink');

    undo.undo(); // undoes the colour
    expect(snapshot(doc).find((n) => n.id === a)?.color).toBe('yellow');
    expect(undo.canRedo()).toBe(true);

    moveObject(doc, a, 400, 400); // new change
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07: undo of a move whose target was deleted by a peer is a no-op; history stays usable', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 200, y: 200 }) as string;
    const b = createSticky(doc, { x: 600, y: 200 }) as string;
    const c = createSticky(doc, { x: 900, y: 200 }) as string;
    const undo = createUndo(doc);

    moveObject(doc, c, 950, 250);
    undo.boundary();
    moveObject(doc, a, 250, 300); // top of my history targets the note the peer deletes
    undo.boundary();
    moveObject(doc, b, 650, 250);

    const peer = createPeer(doc);
    peer.doc.transact(() => {
      peer.doc.getMap('objects').delete(a);
    });
    expect(snapshot(doc).some((n) => n.id === a)).toBe(false);

    // Undo: the top step (c) restores c; the next undo hits A's deleted
    // target — no throw, A stays deleted, and the step below it (b) is
    // still undone. The history remains fully usable.
    expect(() => {
      undo.undo();
      undo.undo();
    }).not.toThrow();

    expect(boundsOf(doc, c)).toEqual({ x: 800, y: 100 });
    expect(boundsOf(doc, b)).toEqual({ x: 500, y: 100 });
    expect(snapshot(doc).some((n) => n.id === a)).toBe(false);
    expect(undo.canUndo()).toBe(false);
    peer.destroy();
  });

  it('TC-08: a peer edits a note, I delete it, undo restores the content at deletion time', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 200, y: 200 }) as string;
    const peer = createPeer(doc);

    const peerText = getStickyText(peer.doc, a);
    expect(peerText).toBeDefined();
    peer.doc.transact(() => {
      peerText?.insert(0, 'edited by peer');
    });
    expect(getStickyText(doc, a)?.toString()).toBe('edited by peer');

    const undo = createUndo(doc);
    deleteObjects(doc, [a]);
    expect(snapshot(doc)).toHaveLength(0);

    undo.undo();
    const after = snapshot(doc);
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('edited by peer'); // content at deletion time
    peer.destroy();
  });

  it('TC-09: beyond UNDO_MAX_STEPS the oldest step is discarded first', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: 100 + i * 400, y: 100 }) as string);
      undo.boundary();
    }

    let undone = 0;
    while (undo.canUndo()) {
      expect(undo.undo()).toBe(true);
      undone++;
    }
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);

    // The very first step (the first note) was discarded: that note survives.
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(ids[0]);
  });

  it('TC-10: at the cap (UNDO_MAX_STEPS steps) nothing is discarded', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      createSticky(doc, { x: 100 + i * 400, y: 100 });
      undo.boundary();
    }

    let undone = 0;
    while (undo.canUndo()) {
      expect(undo.undo()).toBe(true);
      undone++;
    }
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-11: history is session-only — a fresh controller on the same doc starts empty', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 200, y: 200 }) as string;
    const undo = createUndo(doc);

    moveObject(doc, a, 300, 300);
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    expect(undo.canUndo()).toBe(false); // destroyed controller reports empty
    expect(undo.undo()).toBe(false);

    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    // The doc itself is untouched by destroying the controller.
    expect(boundsOf(doc, a)).toEqual({ x: 300, y: 300 });
  });

  it('undo on an empty history is a no-op returning false (PRD undo.empty)', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });

  it('a plain untransacted local write is not tracked (origin null ≠ LOCAL_ORIGIN)', () => {
    const doc = freshDoc();
    const a = createSticky(doc, { x: 200, y: 200 }) as string;
    const undo = createUndo(doc);
    const m = doc.getMap('objects').get(a) as Y.Map<unknown> | undefined;
    m?.set('color', 'pink'); // no transact: origin null
    expect(undo.canUndo()).toBe(false);
  });
});
