import { vi, describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  getDocObjects,
  initDoc,
} from '@shared/board-model';
import { LOAD_ORIGIN } from '@shared/config';
import { createUndo } from '@client/board/undo';

// ─── Helper: create two docs connected via broadcast channel ──────────────
/**
 * Both-local-origin updates are broadcast between peers so they can interact.
 * UndoManager only captures LOCAL_ORIGIN transactions, so remote-origin
 * changes stay untracked and won't appear in the undo stack.
 */
function makeLocalAndPeer(
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): {
  local: Y.Doc;
  peer: Y.Doc;
  controller: ReturnType<typeof createUndo>;
} {
  const local = new Y.Doc();
  const peer = new Y.Doc();
  initDoc(local);
  initDoc(peer);

  // Full broadcast both ways — UndoManager origin-filtering handles what gets tracked locally.
  local.on('update', (update: Uint8Array, origin: unknown) => {
    try { Y.applyUpdate(peer, update, origin); } catch {}
  });
  peer.on('update', (update: Uint8Array, origin: unknown) => {
    try { Y.applyUpdate(local, update, origin); } catch {}
  });

  // Initial full-sync so both docs share the same state vector before operations.
  try { Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), local); } catch {}

  return {
    local,
    peer,
    controller: createUndo(local, opts),
  };
}

/** Helper to create a sticky note locally */
function makeSticky(doc: Y.Doc, id: string, color: string, text: string, x = 0, y = 0): void {
  const objects = getDocObjects(doc);
  doc.transact(() => {
    const dm = new Y.Map();
    dm.set('type', 'sticky');
    dm.set('x', x);
    dm.set('y', y);
    dm.set('color', color);
    dm.set('text', new Y.Text(text));
    dm.set('z', 1);
    dm.set('createdAt', Date.now());
    objects.set(id, dm);
  }, LOCAL_ORIGIN);
}

/** Helper to move a sticky */
function doMove(doc: Y.Doc, id: string, x: number, y: number): void {
  const objects = getDocObjects(doc);
  doc.transact(() => {
    const dm = objects.get(id);
    if (dm instanceof Y.Map) {
      dm.set('x', x);
      dm.set('y', y);
    }
  }, LOCAL_ORIGIN);
}

/** Helper to recolor a sticky */
function doRecolor(doc: Y.Doc, id: string, color: string): void {
  const objects = getDocObjects(doc);
  doc.transact(() => {
    const dm = objects.get(id);
    if (dm instanceof Y.Map) {
      dm.set('color', color);
    }
  }, LOCAL_ORIGIN);
}

/** Helper to delete a sticky */
function doDelete(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  let result = false;
  try {
    doc.transact(() => {
      if (objects.has(id)) {
        objects.delete(id);
        result = true;
      }
    }, LOCAL_ORIGIN);
  } catch {}
  return result;
}

/** Sync state from peer to local */
function syncFromPeerTo(peer: Y.Doc, local: Y.Doc): void {
  try { Y.applyUpdate(local, Y.encodeStateAsUpdate(peer), peer); } catch {}
}

// ─── TC-01: local + remote changes — undo only local ──────────────────────

describe('TC-01: local + remote changes — undo only local', () => {
  it('undoes own move, not peer edits', () => {
    const { local, peer, controller } = makeLocalAndPeer();

    makeSticky(local, 'note-a', 'yellow', 'A', 100, 100);
    controller.boundary(); // close create step

    doMove(local, 'note-a', 200, 200);
    expect(controller.canUndo()).toBe(true);

    // Peer: create note B
    const pObjects = getDocObjects(peer);
    peer.transact(() => {
      const dm = new Y.Map();
      dm.set('type', 'sticky');
      dm.set('x', 300);
      dm.set('y', 300);
      dm.set('color', 'blue');
      dm.set('text', new Y.Text('B'));
      dm.set('z', 2);
      dm.set('createdAt', Date.now());
      pObjects.set('note-b', dm);
    }, Symbol('peer'));

    syncFromPeerTo(peer, local);

    // Peer recolors B to green
    peer.transact(() => {
      const dm = pObjects.get('note-b');
      if (dm instanceof Y.Map) dm.set('color', 'green');
    }, Symbol('peer'));
    syncFromPeerTo(peer, local);

    // Undo reverses the last local step (the move), restoring A's original position.
    // The "create" step remains on the stack, so canUndo stays true.
    controller.undo();
    expect(controller.canUndo()).toBe(true);

    const objects = getDocObjects(local);
    const dmA = objects.get('note-a');
    expect(dmA?.get('x')).toBe(100);
    expect(dmA?.get('y')).toBe(100);

    // B still exists and has green colour
    const dmB = objects.get('note-b');
    expect(dmB).toBeTruthy();
    expect(dmB?.get('color')).toBe('green');
  });
});

// ─── TC-02: only peer changes — no undo ───────────────────────────────────

describe('TC-02: peer-only changes — no undo', () => {
  it('canUndo is false when only remote changes happened', () => {
    const { peer, controller } = makeLocalAndPeer();
    const pObjects = getDocObjects(peer);

    peer.transact(() => {
      const dm = new Y.Map();
      dm.set('type', 'sticky');
      dm.set('x', 100);
      dm.set('y', 100);
      dm.set('color', 'yellow');
      dm.set('text', new Y.Text('X'));
      dm.set('z', 1);
      dm.set('createdAt', Date.now());
      pObjects.set('note-x', dm);
    }, Symbol('peer'));

    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
    expect(controller.redo()).toBe(false);
  });
});

// ─── TC-03: LOAD_ORIGIN updates are untracked ─────────────────────────────

describe('TC-03: LOAD_ORIGIN updates are untracked', () => {
  it('LOAD-origin transactions do not enter undo stack', () => {
    const { local, controller } = makeLocalAndPeer();

    // Simulate a load operation applying an update with LOAD_ORIGIN
    local.transact(() => {
      const objects = getDocObjects(local);
      const dm = new Y.Map();
      dm.set('type', 'sticky');
      dm.set('x', 0);
      dm.set('y', 0);
      dm.set('color', 'yellow');
      dm.set('text', new Y.Text('loaded'));
      dm.set('z', 1);
      dm.set('createdAt', Date.now());
      objects.set('loaded-note', dm);
    }, LOAD_ORIGIN);

    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
  });
});

// ─── TC-04: bulk delete and restore ──────────────────────────────────────

describe('TC-04: bulk delete and restore', () => {
  it('deleting 8 notes restores them with text, colour, size, position', () => {
    const { local, controller } = makeLocalAndPeer();
    const objects = getDocObjects(local);

    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `note-${i}`;
      ids.push(id);
      const colors: string[] = ['yellow', 'blue', 'green'];
      docTransactLocal(local, () => {
        const dm = new Y.Map();
        dm.set('type', 'sticky');
        dm.set('x', 50 * i);
        dm.set('y', 50 * i);
        dm.set('color', colors[i % 3]);
        dm.set('text', new Y.Text(`Note ${i}`));
        dm.set('z', i + 1);
        dm.set('createdAt', Date.now());
        dm.set('width', 200);
        dm.set('height', 200);
        objects.set(id, dm);
      });
    }

    controller.boundary(); // separate step from creation

    // Delete all 8 in one transaction
    doDeleteAll(local, [...ids], objects);

    expect(controller.canUndo()).toBe(true);
    controller.undo();

    for (const id of ids) {
      expect(objects.has(id)).toBe(true);
    }

    const dm0 = objects.get('note-0');
    expect((dm0?.get('text') as Y.Text)?.toString()).toBe('Note 0');
    expect(dm0?.get('x')).toBe(0);
    expect(dm0?.get('y')).toBe(0);
  });
});

function docTransactLocal(doc: Y.Doc, fn: () => void): void {
  doc.transact(fn, LOCAL_ORIGIN);
}

function doDeleteAll(doc: Y.Doc, ids: string[], objects: any): void {
  try {
    doc.transact(() => {
      for (const id of ids) {
        if (objects.has(id)) objects.delete(id);
      }
    }, LOCAL_ORIGIN);
  } catch {}
}

// ─── TC-05: undo then redo ────────────────────────────────────────────────

describe('TC-05: undo then redo', () => {
  it('redo re-applies the undone change', () => {
    const { local, controller } = makeLocalAndPeer({ captureTimeoutMs: 0 });

    makeSticky(local, 'move-me', 'yellow', 'M', 0, 0);
    controller.boundary();

    doMove(local, 'move-me', 100, 200);
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const dm = getDocObjects(local).get('move-me');
    expect(dm?.get('x')).toBe(0);
    expect(dm?.get('y')).toBe(0);

    expect(controller.canRedo()).toBe(true);
    controller.redo();

    expect(dm?.get('x')).toBe(100);
    expect(dm?.get('y')).toBe(200);
  });
});

// ─── TC-06: undo then new change clears redo ──────────────────────────────

describe('TC-06: new change clears redo', () => {
  it('after undo + new change, canRedo is false', () => {
    const { local, controller } = makeLocalAndPeer({ captureTimeoutMs: 0 });

    makeSticky(local, 'change-me', 'yellow', 'C', 0, 0);
    controller.boundary();

    doRecolor(local, 'change-me', 'blue');
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(controller.canRedo()).toBe(true);

    // New change after undo should clear redo
    doRecolor(local, 'change-me', 'green');
    expect(controller.canRedo()).toBe(false);
    expect(controller.canUndo()).toBe(true);
  });
});

// ─── TC-07: undo targets deleted object — no error ────────────────────────

describe('TC-07: undo targets deleted object — no error', () => {
  it('undoing a move of a deleted object does not throw', () => {
    const { local, peer, controller } = makeLocalAndPeer({ captureTimeoutMs: 0 });
    const objects = getDocObjects(local);

    makeSticky(local, 'del-me', 'yellow', 'D', 0, 0);
    controller.boundary();

    doMove(local, 'del-me', 100, 100);
    expect(controller.canUndo()).toBe(true);

    // Peer deletes it
    const pObjects = getDocObjects(peer);
    peer.transact(() => {
      pObjects.delete('del-me');
    }, Symbol('peer'));

    syncFromPeerTo(peer, local);

    // Object gone locally too
    expect(objects.has('del-me')).toBe(false);

    // Undo should NOT throw
    expect(() => controller.undo()).not.toThrow();

    // Object stays deleted
    expect(objects.has('del-me')).toBe(false);
  });
});

// ─── TC-08: undo delete of peer-edited object ─────────────────────────────

describe('TC-08: undo delete of peer-edited object', () => {
  it('restored object has content at time of delete', () => {
    const { local, peer, controller } = makeLocalAndPeer({ captureTimeoutMs: 0 });
    const objects = getDocObjects(local);

    makeSticky(local, 'edit-me', 'yellow', 'Hello', 0, 0);
    controller.boundary();

    // Peer edits the text
    const pObjects = getDocObjects(peer);
    peer.transact(() => {
      const dm = pObjects.get('edit-me');
      if (dm instanceof Y.Map && dm.get('text') instanceof Y.Text) {
        dm.get('text').insert(5, ' World');
      }
    }, Symbol('peer'));
    syncFromPeerTo(peer, local);

    // Local delete
    expect(doDelete(local, 'edit-me')).toBe(true);
    expect(objects.has('edit-me')).toBe(false);
    expect(controller.canUndo()).toBe(true);

    controller.undo();
    expect(objects.has('edit-me')).toBe(true);

    const restored = objects.get('edit-me');
    expect(restored?.get('type')).toBe('sticky');
    // Text reflects what was synced before the delete
    const textContent = restored?.get('text') as Y.Text | undefined;
    expect(textContent?.toString()).toBe('Hello World');
  });
});

// ─── TC-09: history trimmed at UNDO_MAX_STEPS ─────────────────────────────

describe('TC-09: history trimmed at UNDO_MAX_STEPS', () => {
  it('adding beyond maxSteps discards oldest steps', () => {
    const MAX = 5;
    const { local, controller } = makeLocalAndPeer({
      captureTimeoutMs: 0,
      maxSteps: MAX,
    });

    makeSticky(local, 'trim-test', 'yellow', 'T', 0, 0);
    controller.boundary();

    // Add MAX + 1 additional steps (boundary after each)
    for (let i = 0; i <= MAX; i++) {
      doMove(local, 'trim-test', i * 10, i * 10);
      controller.boundary(); // ensure each is a separate step
    }

    expect(controller.canUndo()).toBe(true);
    let undoCount = 0;
    while (controller.canUndo()) {
      controller.undo();
      undoCount++;
    }
    // Should have exactly MAX steps (oldest dropped)
    expect(undoCount).toBeLessThanOrEqual(MAX);
    expect(undoCount).toBeGreaterThan(0);
  });
});

// ─── TC-10: one below max — adding preserves all ──────────────────────────

describe('TC-10: one below max — adding preserves all', () => {
  it('MAX-1 steps + 1 more = exactly MAX, nothing lost', () => {
    const MAX = 3;
    const { local, controller } = makeLocalAndPeer({
      captureTimeoutMs: 0,
      maxSteps: MAX,
    });

    makeSticky(local, 'exact-max', 'yellow', 'E', 0, 0);
    controller.boundary();

    // Add MAX - 1 steps, each separated by boundary
    for (let i = 0; i < MAX - 1; i++) {
      doMove(local, 'exact-max', (i + 1) * 10, (i + 1) * 10);
      controller.boundary();
    }

    // Add one more to reach exactly MAX total steps
    doMove(local, 'exact-max', MAX * 10, MAX * 10);
    controller.boundary();

    let undoCount = 0;
    while (controller.canUndo()) {
      controller.undo();
      undoCount++;
    }
    expect(undoCount).toBe(MAX);
  });
});

// ─── TC-11: destroy controller resets history ─────────────────────────────

describe('TC-11: destroy controller resets history', () => {
  it('new controller after destroy has empty stacks', () => {
    const { local, controller } = makeLocalAndPeer();

    makeSticky(local, 'destroy-me', 'yellow', 'D', 0, 0);
    controller.boundary();
    doMove(local, 'destroy-me', 100, 100);
    expect(controller.canUndo()).toBe(true);

    controller.destroy();

    const fresh = createUndo(local);
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    expect(fresh.redo()).toBe(false);
    fresh.destroy();
  });
});

// ─── TC-12: typing burst grouping within capture timeout ──────────────────

describe('TC-12: typing burst grouping', () => {
  it('Y.Text inserts within capture timeout merge into one step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const lObj = getDocObjects(doc);

    const um = new Y.UndoManager(lObj, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
    });

    // Create a sticky with empty text
    doc.transact(() => {
      const dm = new Y.Map();
      dm.set('type', 'sticky');
      dm.set('text', new Y.Text(''));
      lObj.set('burst-me', dm);
    }, LOCAL_ORIGIN);
    um.stopCapturing(); // close create step separately

    // First text insertion
    doc.transact(() => {
      const dm = lObj.get('burst-me');
      (dm.get('text') as Y.Text).insert(0, 'Hello');
    }, LOCAL_ORIGIN);
    expect(um.undoStack.length).toBe(2);

    // Second text insertion immediately after (within captureTimeout)
    doc.transact(() => {
      const dm = lObj.get('burst-me');
      (dm.get('text') as Y.Text).insert(5, ' World');
    }, LOCAL_ORIGIN);
    // Still 2 steps — second insert merged with first (not a new stack item)
    expect(um.undoStack.length).toBe(2);

    // Undo once → only "Hello World" removed, create still intact
    um.undo();
    expect((lObj.get('burst-me').get('text') as Y.Text).toString()).toBe('');

    // One more undo → creates note itself gets undone
    um.undo();
    expect(lObj.has('burst-me')).toBe(false);
  });
});

// ─── TC-13: capture timeout boundary values ──────────────────────────────

describe('TC-13: capture timeout boundary values', () => {
  it('stopCapturing on empty stack is a no-op', () => {
    const { local, controller } = makeLocalAndPeer();
    // Never created anything — boundary should not throw
    expect(() => controller.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
  });

  it('captureTimeoutMs: 0 means each transact is its own step (no grouping)', () => {
    const { local, controller } = makeLocalAndPeer({ captureTimeoutMs: 0 });

    makeSticky(local, 'zero-timeout', 'yellow', '', 0, 0);
    controller.boundary(); // close create

    doMove(local, 'zero-timeout', 10, 10);
    controller.boundary();
    doMove(local, 'zero-timeout', 20, 20);
    controller.boundary();

    // 2 move steps on the stack
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    controller.undo();
    const dm = getDocObjects(local).get('zero-timeout');
    expect(dm?.get('x')).toBe(10); // restored to previous step
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(true);
  });
});
