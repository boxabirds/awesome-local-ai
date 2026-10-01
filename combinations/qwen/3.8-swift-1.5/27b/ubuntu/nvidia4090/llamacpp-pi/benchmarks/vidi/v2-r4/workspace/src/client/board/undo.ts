import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * Per-user undo/redo over the board's objects map.
 *
 * The controller wraps a Y.UndoManager that tracks LOCAL_ORIGIN transactions
 * only, so each tab's history contains exclusively this person's own changes.
 * Remote updates (provider origin) and story 4 load updates are never
 * captured, which is what makes undo safe on a shared board (undo.own).
 *
 * History is session-only: the controller lives in memory and is destroyed on
 * board change or unmount (undo.session_only).
 */
export interface UndoController {
  /** Reverses the most recent own step. False when the undo stack is empty. */
  undo(): boolean;
  /** Re-applies the most recently undone step. False when the redo stack is empty. */
  redo(): boolean;
  /** Closes the current capture window so the next local change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Adds another type to the undo scope (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribes to stack changes (items added or popped). Returns an unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Disposes the manager and all subscriptions. */
  destroy(): void;
}

export interface CreateUndoOptions {
  /** Pause (ms) that groups consecutive local changes into one step. */
  captureTimeoutMs?: number;
  /** Maximum number of undo steps kept. */
  maxSteps?: number;
}

type DeleteSetLike = { clients: Map<number, Array<{ clock: number; len: number }>> };
type Struct = Y.Item | Y.GC | Y.Skip;

/**
 * Yields the structs referenced by a DeleteSet (client/clock ranges),
 * resolved against the doc's current struct store. GC'd structs surface as
 * Y.GC items, so callers can tell a "deleted, still restorable" item apart
 * from a "garbage-collected, gone forever" one.
 */
function* structsIn(doc: Y.Doc, ds: DeleteSetLike): Generator<Struct> {
  const store = (doc as unknown as { store: { clients: Map<number, Struct[]> } }).store;
  for (const [clientID, deletes] of ds.clients) {
    const structs = store.clients.get(clientID);
    if (!structs) continue;
    for (const del of deletes) {
      let i = 0;
      while (i < structs.length && structs[i].id.clock + structs[i].length <= del.clock) i++;
      let cursor = del.clock;
      let remaining = del.len;
      while (remaining > 0 && i < structs.length) {
        const s = structs[i];
        const end = s.id.clock + s.length;
        if (end <= cursor) {
          i++;
          continue;
        }
        yield s;
        const overlapEnd = Math.min(end, cursor + remaining);
        remaining -= overlapEnd - cursor;
        cursor = overlapEnd;
        i++;
      }
    }
  }
}

/** True when every ancestor container of `item` is still alive. */
function parentChainLive(item: Y.Item): boolean {
  let type: unknown = (item as unknown as { parent: unknown }).parent;
  while (type != null) {
    const parentItem = (type as { _item?: Y.Item | null })._item ?? null;
    if (parentItem == null) return true; // reached the doc root
    if (parentItem.deleted) return false;
    type = (parentItem as unknown as { parent: unknown }).parent;
  }
  return true;
}

/**
 * Resolves the struct at an ID (client/clock) in the doc's struct store.
 */
function findStructAt(doc: Y.Doc, id: { client: number; clock: number }): Struct | null {
  const store = (doc as unknown as { store: { clients: Map<number, Struct[]> } }).store;
  const structs = store.clients.get(id.client);
  if (!structs) return null;
  let i = 0;
  while (i < structs.length && structs[i].id.clock + structs[i].length <= id.clock) i++;
  if (i >= structs.length) return null;
  const s = structs[i];
  return s.id.clock + s.length > id.clock ? s : null;
}

/**
 * Follows the `redone` chain to the item that currently stands in for
 * `item`. Yjs's redoItem never reuses deleted structs: it integrates a fresh
 * item and points the original's `redone` at it. popStackItem does the same
 * follow-up before deciding what to delete, so the staleness check must too.
 */
function redoneEnd(doc: Y.Doc, item: Y.Item): Y.Item {
  let cur = item;
  let hops = 0;
  while (cur.redone != null && hops++ < 10_000) {
    const next = findStructAt(doc, cur.redone);
    if (!(next instanceof Y.Item)) break;
    cur = next;
  }
  return cur;
}

/**
 * A stack item's inverse (popStackItem) is visible iff it would delete a
 * still-alive item it inserted (following redone replacements), or restore a
 * deleted item that has no redone replacement and whose parent chain is
 * still alive. Items that are GC'd or already replaced produce no visible
 * change — and letting Yjs pop them would cascade into the previous step.
 */
function popHasEffect(doc: Y.Doc, item: Y.UndoManager['undoStack'][number]): boolean {
  for (const s of structsIn(doc, item.insertions)) {
    if (s instanceof Y.Item && !redoneEnd(doc, s).deleted) return true;
  }
  for (const s of structsIn(doc, item.deletions)) {
    if (s instanceof Y.Item && s.deleted && s.redone == null && parentChainLive(s)) return true;
  }
  return false;
}

export function createUndo(doc: Y.Doc, opts?: CreateUndoOptions): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  // Only this tab's own transactions are tracked; the manager itself is added
  // to trackedOrigins by Yjs so its own inverse operations are recognised.
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const emitChange = () => {
    for (const cb of [...listeners]) cb();
  };

  const onStackItemAdded = () => {
    // Keep at most maxSteps steps: drop the oldest first (undo.limit)
    const stack = manager.undoStack;
    while (stack.length > maxSteps) {
      stack.shift();
    }
    emitChange();
  };
  const onStackItemPopped = () => emitChange();

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackItemPopped);

  /**
   * Pops the top step of `stack` when its inverse is now a pure no-op (its
   * targets were removed by someone else), without letting Yjs cascade into
   * the previous step. Yjs's popStackItem loops until a popped item performs
   * a visible change, so a stale top step would silently undo an earlier,
   * unrelated change of ours — which violates the per-user undo contract.
   * Returns true when a stale step was consumed.
   */
  const consumeStaleTop = (
    stack: Y.UndoManager['undoStack'],
    hasEffect: (item: Y.UndoManager['undoStack'][number]) => boolean,
  ): boolean => {
    if (stack.length === 0) return false;
    if (hasEffect(stack[stack.length - 1])) return false;
    stack.pop();
    emitChange();
    return true;
  };

  return {
    undo() {
      if (!manager.canUndo()) return false;
      if (consumeStaleTop(manager.undoStack, (item) => popHasEffect(doc, item))) return true;
      manager.undo();
      return true;
    },
    redo() {
      if (!manager.canRedo()) return false;
      if (consumeStaleTop(manager.redoStack, (item) => popHasEffect(doc, item))) return true;
      manager.redo();
      return true;
    },
    boundary() {
      manager.stopCapturing();
    },
    canUndo() {
      return manager.canUndo();
    },
    canRedo() {
      return manager.canRedo();
    },
    addScope(type) {
      manager.addToScope(type);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', onStackItemPopped);
      manager.destroy();
      listeners.clear();
    },
  };
}
