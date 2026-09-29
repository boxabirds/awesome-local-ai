// Story 8 (undo.history) unit tests: TC-01 to TC-11. Real Y.Docs, real
// createUndo, a simulated remote peer (tests/unit/peer.ts) for remote and
// LOAD-origin changes.

import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  LOCAL_ORIGIN,
  moveObjects,
  objectsSnapshot,
  resizeObjects,
  setStickyColor,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyLoad, RemotePeer } from './peer';

const docs: Y.Doc[] = [];

/** Creates a doc, optionally seeds it (BEFORE the controller exists, so the
 *  stack starts empty), and builds the controller under test. */
function setup(seed?: (doc: Y.Doc) => void): { doc: Y.Doc; ctl: UndoController } {
  const doc = new Y.Doc();
  docs.push(doc);
  if (seed) seed(doc);
  return { doc, ctl: createUndo(doc) };
}

afterEach(() => {
  while (docs.length > 0) docs.pop()?.destroy();
});

/** One meaningful local step: boundary, mutate, boundary (undo.steps). */
function step(ctl: UndoController, mutate: () => void): void {
  ctl.boundary();
  mutate();
  ctl.boundary();
}

function find(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return objectsSnapshot(doc).find((o) => o.id === id);
}

/** Seeds `n` stickies in a row of world positions 400 apart; returns ids. */
function seedRow(doc: Y.Doc, n: number, y = 0): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(createSticky(doc, { x: 400 * i, y }));
  return ids;
}

/** Seeds one peer-created sticky entry (for remote-change tests). */
function peerCreate(p: Y.Doc, id: string, x: number, color: string): void {
  const entry = new Y.Map<unknown>();
  entry.set('type', 'sticky');
  entry.set('x', x);
  entry.set('y', 0);
  entry.set('color', color);
  entry.set('text', new Y.Text());
  entry.set('z', 99);
  entry.set('createdAt', 1);
  p.getMap('objects').set(id, entry);
}

describe('undo.history: per-user stacks (TC-01 to TC-11)', () => {
  it('TC-01: my undo reverses only my move; peer create + recolour stay', () => {
    const { doc, ctl } = setup((d) => {
      seedRow(d, 2);
    });
    const [x, z] = objectsSnapshot(doc)
      .map((o) => o.id)
      .sort();
    const x0 = find(doc, x)!;
    const peer = new RemotePeer();

    step(ctl, () => {
      moveObjects(doc, new Map([[x, { x: x0.x + 250, y: x0.y + 100 }]]));
    });

    // Peer creates Y and recolours Z (non-local origin).
    peer.apply(doc, (p) => {
      peerCreate(p, 'peer-note', 1000, 'green');
      (p.getMap('objects').get(z) as Y.Map<unknown>).set('color', 'blue');
    });

    expect(ctl.canUndo()).toBe(true);
    expect(ctl.undo()).toBe(true);

    // X restored to its old position...
    expect(find(doc, x)!.x).toBe(x0.x);
    expect(find(doc, x)!.y).toBe(x0.y);
    // ...Y still exists...
    expect(find(doc, 'peer-note')).not.toBeUndefined();
    // ...and Z keeps the peer's colour (remote change not undone).
    expect(find(doc, z)!.color).toBe('blue');
    // Nothing more of mine to undo.
    expect(ctl.undo()).toBe(false);
  });

  it('TC-02: peer changes only → canUndo stays false', () => {
    const { doc, ctl } = setup((d) => {
      seedRow(d, 1);
    });
    const peer = new RemotePeer();
    peer.apply(doc, (p) => {
      peerCreate(p, 'peer-note', 100, 'green');
    });

    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
    expect(ctl.canRedo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates are never captured', () => {
    const { doc, ctl } = setup();
    const peer = new RemotePeer();
    peer.apply(doc, (p) => {
      peerCreate(p, 'loaded-note', 100, 'yellow');
    });
    applyLoad(doc, peer.stateUpdate());

    // The loaded note is present on the local doc...
    expect(find(doc, 'loaded-note')).not.toBeUndefined();
    // ...but load updates are not undoable (story 4 behaviour).
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);
  });

  it('TC-04: deleting 8 notes is one step; undo restores all with text, colour, size, position', () => {
    const { doc, ctl } = setup((d) => {
      const ids = seedRow(d, 8);
      const colors = ['orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'blue', 'green'];
      ids.forEach((id, i) => {
        setStickyColor(d, id, colors[i]);
        const text = getStickyText(d, id);
        if (text) d.transact(() => text.insert(0, `note ${i}`), LOCAL_ORIGIN);
        if (i < 2) {
          const o = objectsSnapshot(d).find((s) => s.id === id)!;
          resizeObjects(d, new Map([[id, { x: o.x, y: o.y, width: 260 - i * 120, height: 260 - i * 120 }]]));
        }
      });
    });
    const ids = objectsSnapshot(doc).map((o) => o.id).sort();
    const before = ids.map((id) => find(doc, id)!);

    step(ctl, () => {
      deleteObjects(doc, ids);
    });
    for (const id of ids) expect(find(doc, id)).toBeUndefined();

    // ONE undo step restores everything.
    expect(ctl.undo()).toBe(true);
    ids.forEach((id, i) => {
      const after = find(doc, id)!;
      const b = before[i];
      expect(after).not.toBeUndefined();
      expect(after.x).toBe(b.x);
      expect(after.y).toBe(b.y);
      expect(after.color).toBe(b.color);
      expect(after.text).toBe(b.text);
      expect(after.width ?? 200).toBe(b.width ?? 200);
      expect(after.height ?? 200).toBe(b.height ?? 200);
    });
    expect(ctl.canUndo()).toBe(false);
  });

  it('TC-05: undo then redo re-applies the move', () => {
    const { doc, ctl } = setup((d) => {
      seedRow(d, 1);
    });
    const [a] = objectsSnapshot(doc).map((o) => o.id).sort();
    const a0 = find(doc, a)!;

    step(ctl, () => {
      moveObjects(doc, new Map([[a, { x: a0.x + 120, y: a0.y - 80 }]]));
    });

    expect(ctl.undo()).toBe(true);
    expect(find(doc, a)!.x).toBe(a0.x);
    expect(find(doc, a)!.y).toBe(a0.y);
    expect(ctl.canRedo()).toBe(true);

    expect(ctl.redo()).toBe(true);
    expect(find(doc, a)!.x).toBe(a0.x + 120);
    expect(find(doc, a)!.y).toBe(a0.y - 80);
    expect(ctl.canRedo()).toBe(false);
  });

  it('TC-06: a new change after undoing clears redo', () => {
    const { doc, ctl } = setup((d) => {
      seedRow(d, 2);
    });
    const [a, b] = objectsSnapshot(doc).map((o) => o.id).sort();
    const a0 = find(doc, a)!;
    const b0 = find(doc, b)!;

    step(ctl, () => {
      moveObjects(doc, new Map([[a, { x: a0.x + 60, y: a0.y }]]));
    });
    expect(ctl.undo()).toBe(true);
    expect(ctl.canRedo()).toBe(true);

    step(ctl, () => {
      moveObjects(doc, new Map([[b, { x: b0.x - 40, y: b0.y }]]));
    });
    expect(ctl.canRedo()).toBe(false);
    // Only the new step remains: undoing it restores B; nothing else left.
    expect(ctl.undo()).toBe(true);
    expect(find(doc, b)!.x).toBe(b0.x);
    expect(ctl.canUndo()).toBe(false);
  });

  it('TC-07: undoing a move of a remotely deleted note: no throw, stays deleted, history usable', () => {
    const { doc, ctl } = setup((d) => {
      seedRow(d, 3);
    });
    const [a, b, c] = objectsSnapshot(doc).map((o) => o.id).sort();
    const b0 = find(doc, b)!;
    const c0 = find(doc, c)!;

    // Three moves, A's LAST (it is the top of the undo stack).
    step(ctl, () => {
      moveObjects(doc, new Map([[c, { x: c0.x + 150, y: c0.y }]]));
    });
    step(ctl, () => {
      moveObjects(doc, new Map([[b, { x: b0.x + 100, y: b0.y }]]));
    });
    step(ctl, () => {
      moveObjects(doc, new Map([[a, { x: find(doc, a)!.x + 300, y: find(doc, a)!.y + 300 }]]));
    });

    // A colleague deletes A in the meantime.
    const peer = new RemotePeer();
    peer.apply(doc, (p) => {
      p.getMap('objects').delete(a);
    });
    expect(find(doc, a)).toBeUndefined();

    // Undoing the no-effect step never throws; yjs consumes it together
    // with the next applicable one (B's move).
    expect(() => ctl.undo()).not.toThrow();
    // A is NOT recreated by undoing its move...
    expect(find(doc, a)).toBeUndefined();
    // ...B's move was undone...
    expect(find(doc, b)!.x).toBe(b0.x);
    // ...and C's move is still in flight (not consumed yet).
    expect(find(doc, c)!.x).toBe(c0.x + 150);

    // The rest of the history is still usable: C's move is undone next.
    expect(ctl.undo()).toBe(true);
    expect(find(doc, c)!.x).toBe(c0.x);
    expect(ctl.canUndo()).toBe(false);
  });

  it('TC-08: undoing my delete of a note a peer edited restores the content at my delete time', () => {
    const { doc, ctl } = setup((d) => {
      seedRow(d, 1);
    });
    const [a] = objectsSnapshot(doc).map((o) => o.id).sort();

    // The peer edits the note's text before my delete.
    const peer = new RemotePeer();
    peer.apply(doc, (p) => {
      const entry = p.getMap('objects').get(a) as Y.Map<unknown>;
      const text = entry.get('text') as Y.Text;
      text.insert(0, 'peer edit'); // origin: the peer transact (PEER_ORIGIN)
    });
    expect(find(doc, a)!.text).toBe('peer edit');

    step(ctl, () => {
      deleteObjects(doc, [a]);
    });
    expect(find(doc, a)).toBeUndefined();

    expect(ctl.undo()).toBe(true);
    const after = find(doc, a)!;
    expect(after).not.toBeUndefined();
    expect(after.text).toBe('peer edit'); // content at the time of my delete
  });

  it('TC-09: at UNDO_MAX_STEPS a new step drops the OLDEST step', () => {
    const { doc, ctl } = setup();
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      ids.push(createSticky(doc, { x: 400 * i, y: 0 }));
      ctl.boundary();
    }

    // UNDO_MAX_STEPS undos succeed; the (UNDO_MAX_STEPS+1)th finds nothing.
    for (let i = 0; i < UNDO_MAX_STEPS; i++) expect(ctl.undo()).toBe(true);
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);

    // The OLDEST step was dropped: the first seeded note survived, all the
    // other UNDO_MAX_STEPS notes were undone away.
    expect(find(doc, ids[0])).not.toBeUndefined();
    for (let i = 1; i < ids.length; i++) expect(find(doc, ids[i])).toBeUndefined();
  });

  it('TC-10: at UNDO_MAX_STEPS − 1, one more step is kept (nothing dropped)', () => {
    const { doc, ctl } = setup();
    const ids: string[] = [];
    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      ids.push(createSticky(doc, { x: 400 * i, y: 0 }));
      ctl.boundary();
    }

    for (let i = 0; i < UNDO_MAX_STEPS; i++) expect(ctl.undo()).toBe(true);
    expect(ctl.canUndo()).toBe(false);

    // Nothing was dropped: every seeded note was undone away.
    for (const id of ids) expect(find(doc, id)).toBeUndefined();
  });

  it('TC-11: history is session-only: a fresh controller after destroy starts empty', () => {
    const { doc, ctl } = setup();
    createSticky(doc, { x: 0, y: 0 });
    ctl.boundary();
    expect(ctl.canUndo()).toBe(true);

    ctl.destroy();
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.undo()).toBe(false);

    // A reload = a new controller on the same doc: empty history.
    const fresh = createUndo(doc);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    fresh.destroy();
  });
});
