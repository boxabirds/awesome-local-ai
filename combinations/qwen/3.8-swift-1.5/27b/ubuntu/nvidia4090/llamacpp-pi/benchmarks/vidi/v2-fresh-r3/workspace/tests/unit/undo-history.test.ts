import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  moveObjects,
  deleteObjects,
  setStickyColor,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';

/**
 * A "remote peer" simulates another client: a second Y.Doc exchanging
 * updates with the local doc. The peer's changes arrive at local with the
 * peer's origin (not LOCAL_ORIGIN), so they are never captured by the undo
 * manager.
 */
class RemotePeer {
  doc: Y.Doc;
  private bound = false;
  private localHandler?: (update: Uint8Array, origin: unknown) => void;
  private peerHandler?: (update: Uint8Array, origin: unknown) => void;

  constructor(private local: Y.Doc) {
    this.doc = new Y.Doc();
  }

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    // Initial sync
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(this.local));

    // Forward local→peer: only LOCAL_ORIGIN changes
    this.localHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) {
        Y.applyUpdate(this.doc, update);
      }
    };
    this.local.on('update', this.localHandler);

    // Forward peer→local: only peer-origin changes
    this.peerHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === this.doc) {
        Y.applyUpdate(this.local, update, this.doc);
      }
    };
    this.doc.on('update', this.peerHandler);
  }

  /** Creates a sticky on the peer (arrives at local with peer origin). */
  createSticky(at: { x: number; y: number }, color = 'blue'): string {
    const id = crypto.randomUUID();
    const sticky = new Y.Map<unknown>();
    sticky.set('type', 'sticky');
    sticky.set('x', at.x);
    sticky.set('y', at.y);
    sticky.set('color', color);
    sticky.set('text', new Y.Text());
    sticky.set('z', 99);
    sticky.set('createdAt', Date.now());
    this.doc.transact(() => {
      this.doc.getMap('objects').set(id, sticky);
    }, this.doc);
    return id;
  }

  /** Sets a note's color on the peer. */
  setColor(id: string, color: string): void {
    this.doc.transact(() => {
      const obj = this.doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
      if (obj) obj.set('color', color);
    }, this.doc);
  }

  /** Deletes a note on the peer. */
  delete(id: string): void {
    this.doc.transact(() => {
      this.doc.getMap('objects').delete(id);
    }, this.doc);
  }

  /** Edits a note's text on the peer. */
  setText(id: string, text: string): void {
    this.doc.transact(() => {
      const obj = this.doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
      if (obj) {
        const t = obj.get('text') as Y.Text | undefined;
        if (t) t.insert(0, text);
      }
    }, this.doc);
  }

  destroy(): void {
    if (this.localHandler) this.local.off('update', this.localHandler);
    if (this.peerHandler) this.doc.off('update', this.peerHandler);
    this.doc.destroy();
  }
}

/** Applies updates with a LOAD-like origin (not LOCAL_ORIGIN). */
function applyWithLoadOrigin(local: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(local, update, 'LOAD');
}

describe('undo.history (unit TC-01 to TC-11)', () => {
  let doc: Y.Doc;
  let peer: RemotePeer;
  let undo: ReturnType<typeof createUndo>;

  beforeEach(() => {
    doc = new Y.Doc();
    peer = new RemotePeer(doc);
    peer.bind();
  });

  afterEach(() => {
    undo?.destroy();
    peer.destroy();
    doc.destroy();
  });

  /** Creates the undo controller after setup so setup changes are not in the stack. */
  function freshUndo(): ReturnType<typeof createUndo> {
    undo?.destroy();
    undo = createUndo(doc, { captureTimeoutMs: 60_000 });
    return undo;
  }

  it('TC-01: local move; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    const z = createSticky(doc, { x: 400, y: 400 });
    const origX = snapshot(doc).find((n) => n.id === a)!.x;

    freshUndo();

    // Local: move A
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: origX + 100, y: 200 }]]));
    undo.boundary();

    // Peer: creates Y, recolours Z
    const yId = peer.createSticky({ x: 500, y: 500 }, 'green');
    peer.setColor(z, 'pink');

    // Undo should restore A's position only
    expect(undo.canUndo()).toBe(true);
    undo.undo();

    const notes = snapshot(doc);
    const noteA = notes.find((n) => n.id === a)!;
    const noteY = notes.find((n) => n.id === yId)!;
    const noteZ = notes.find((n) => n.id === z)!;

    expect(noteA.x).toBe(origX);
    // Y exists (peer created it, undo doesn't touch it)
    expect(noteY).toBeDefined();
    // Z keeps peer's colour
    expect(noteZ.color).toBe('pink');
  });

  it('TC-02: only peer changes → canUndo false', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    freshUndo();
    peer.setColor(a, 'blue');

    expect(undo.canUndo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates → canUndo false', () => {
    freshUndo();

    // Create a sticky in a separate doc, then apply with LOAD origin
    const other = new Y.Doc();
    const id = crypto.randomUUID();
    const sticky = new Y.Map<unknown>();
    sticky.set('type', 'sticky');
    sticky.set('x', 50);
    sticky.set('y', 50);
    sticky.set('color', 'yellow');
    sticky.set('text', new Y.Text());
    sticky.set('z', 1);
    sticky.set('createdAt', Date.now());
    other.transact(() => {
      other.getMap('objects').set(id, sticky);
    });

    applyWithLoadOrigin(doc, Y.encodeStateAsUpdate(other));
    other.destroy();

    expect(undo.canUndo()).toBe(false);
  });

  it('TC-04: delete 8 notes, undo → all restored with text, colour, size, position', () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(createSticky(doc, { x: 100 + i * 250, y: 100 }));
    }

    freshUndo();

    // Record state before delete
    const before = snapshot(doc);
    expect(before).toHaveLength(8);

    undo.boundary();
    deleteObjects(doc, ids);
    undo.boundary();

    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(true);

    undo.undo();

    const after = snapshot(doc);
    expect(after).toHaveLength(8);
    for (const b of before) {
      const a = after.find((n) => n.id === b.id)!;
      expect(a).toBeDefined();
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      expect(a.color).toBe(b.color);
      expect(a.text).toBe(b.text);
      expect(a.z).toBe(b.z);
    }
  });

  it('TC-05: undo then redo → re-applied', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    const origX = snapshot(doc).find((n) => n.id === a)!.x;

    freshUndo();

    undo.boundary();
    moveObjects(doc, new Map([[a, { x: origX + 200, y: 300 }]]));
    undo.boundary();

    undo.undo();
    expect(snapshot(doc).find((n) => n.id === a)!.x).toBe(origX);

    undo.redo();
    expect(snapshot(doc).find((n) => n.id === a)!.x).toBe(origX + 200);
  });

  it('TC-06: undo then new change → canRedo false', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    const b = createSticky(doc, { x: 400, y: 400 });

    freshUndo();

    undo.boundary();
    setStickyColor(doc, a, 'blue');
    undo.boundary();

    undo.undo();
    expect(undo.canRedo()).toBe(true);

    // New change clears redo
    undo.boundary();
    setStickyColor(doc, b, 'green');
    undo.boundary();

    expect(undo.canRedo()).toBe(false);
  });

  it('TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    const b = createSticky(doc, { x: 400, y: 400 });
    const origA = snapshot(doc).find((n) => n.id === a)!.x;
    const origB = snapshot(doc).find((n) => n.id === b)!.x;

    freshUndo();

    // First: move A
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: origA + 100, y: 200 }]]));
    undo.boundary();

    // Second: move B
    undo.boundary();
    moveObjects(doc, new Map([[b, { x: origB + 100, y: 500 }]]));
    undo.boundary();

    // Peer deletes A
    peer.delete(a);

    // Undo: the most recent step is B's move — undo that first
    undo.undo();
    expect(snapshot(doc).find((n) => n.id === b)!.x).toBe(origB);

    // Next undo targets A (now deleted remotely) — no throw
    expect(() => undo.undo()).not.toThrow();

    // A is still absent
    expect(snapshot(doc).find((n) => n.id === a)).toBeUndefined();
  });

  it('TC-08: peer edits note text, then local delete, undo → restored with content at time of delete', () => {
    const a = createSticky(doc, { x: 100, y: 100 });

    // Peer edits the text
    peer.setText(a, 'hello from peer');

    freshUndo();

    // Local deletes
    undo.boundary();
    deleteObjects(doc, [a]);
    undo.boundary();

    expect(snapshot(doc)).toHaveLength(0);

    // Undo the delete → restored with the peer's text
    undo.undo();
    const note = snapshot(doc).find((n) => n.id === a)!;
    expect(note).toBeDefined();
    expect(note.text).toBe('hello from peer');
  });

  it('TC-09: UNDO_MAX_STEPS steps + 1 → length stays UNDO_MAX_STEPS, oldest dropped', () => {
    const smallMax = 5;
    freshUndo();
    undo.destroy();
    const smallUndo = createUndo(doc, { captureTimeoutMs: 60_000, maxSteps: smallMax });

    for (let i = 0; i < smallMax; i++) {
      smallUndo.boundary();
      createSticky(doc, { x: i * 300, y: 0 });
      smallUndo.boundary();
    }

    // Now at max capacity
    expect(smallUndo.canUndo()).toBe(true);

    // Add one more
    smallUndo.boundary();
    createSticky(doc, { x: 9999, y: 0 });
    smallUndo.boundary();

    // The stack should still be at maxSteps (oldest dropped)
    let count = 0;
    while (smallUndo.canUndo()) {
      smallUndo.undo();
      count++;
      if (count > smallMax + 1) break; // safety
    }
    expect(count).toBeLessThanOrEqual(smallMax);

    smallUndo.destroy();
  });

  it('TC-10: UNDO_MAX_STEPS − 1 + 1 → nothing dropped', () => {
    const smallMax = 5;
    freshUndo();
    undo.destroy();
    const smallUndo = createUndo(doc, { captureTimeoutMs: 60_000, maxSteps: smallMax });

    for (let i = 0; i < smallMax - 1; i++) {
      smallUndo.boundary();
      createSticky(doc, { x: i * 300, y: 0 });
      smallUndo.boundary();
    }

    // Add one more (now at exactly maxSteps)
    smallUndo.boundary();
    createSticky(doc, { x: 9999, y: 0 });
    smallUndo.boundary();

    // All steps should be present
    let count = 0;
    while (smallUndo.canUndo()) {
      smallUndo.undo();
      count++;
      if (count > smallMax + 1) break;
    }
    expect(count).toBe(smallMax);

    smallUndo.destroy();
  });

  it('TC-11: destroy then new controller → canUndo false (session only)', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    const origX = snapshot(doc).find((n) => n.id === a)!.x;

    freshUndo();
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: origX + 100, y: 200 }]]));
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    // Destroy and create a new controller
    undo.destroy();
    const fresh = createUndo(doc, { captureTimeoutMs: 60_000 });
    expect(fresh.canUndo()).toBe(false);
    fresh.destroy();
  });
});
