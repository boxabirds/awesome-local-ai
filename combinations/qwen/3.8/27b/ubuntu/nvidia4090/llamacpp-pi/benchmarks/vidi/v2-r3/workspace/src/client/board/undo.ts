import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * Per-user undo and redo (story 8, undo.history / undo.own / undo.session_only).
 *
 * Wraps a Y.UndoManager over the board's objects map whose `trackedOrigins`
 * set contains LOCAL_ORIGIN only. That is the whole mechanism that keeps
 * undo personal: only this tab's own transactions (board-model mutations run
 * `doc.transact(fn, LOCAL_ORIGIN)`) ever enter the undo/redo stacks. Remote
 * changes arrive with the sync provider as origin, story 4 load updates with
 * the LOAD origin — neither is tracked, so undoing can never reverse
 * anyone else's work. Undo/redo themselves apply inverse changes as a new
 * transaction (origin: the manager) that syncs to the room like any other
 * change.
 *
 * Step granularity (undo.steps / undo.typing):
 * - `captureTimeout` (UNDO_CAPTURE_TIMEOUT_MS) merges transactions within the
 *   timeout into one step — right for a burst of typing.
 * - `boundary()` (= stopCapturing) closes the capture window explicitly. It
 *   is called at gesture start/end and edit start/end so drags and edits
 *   never merge with neighbouring actions, while the per-frame writes inside
 *   one drag stay merged.
 * - Group operations (deleteObjects, setStickyColor, createSticky, ...) each
 *   run in one transaction, so they are one step already.
 *
 * The stacks are memory-only: a fresh controller after a reload or board
 * change starts empty (undo.session_only). The undo stack is trimmed to
 * `maxSteps` (UNDO_MAX_STEPS) on add, dropping the oldest step (undo.limit).
 *
 * Delete-wins safety (undo.safe) — the `stepIsSafe` guard. Yjs's UndoManager
 * does not handle a step whose objects were deleted *by someone else*: when
 * it (re)integrates a struct whose ancestor item has been removed by a
 * non-tracked transaction it walks the struct's linked list through the
 * deleted ancestor and corrupts the whole objects map (observed: an entire
 * board reduced to zero objects). So before each undo/redo we inspect the
 * top stack item: every struct it touches must belong to a top-level object
 * that either still exists or is itself re-inserted by this same step. A
 * step that only reaches into a since-deleted object is dropped as a no-op
 * (no throw, no recreation) and the rest of the history stays usable.
 */
export interface UndoController {
  /** Undo this user's most recent change. False when the stack is empty. */
  undo(): boolean;
  /** Re-apply this user's most recently undone change. False when empty. */
  redo(): boolean;
  /** Close the current capture window; the next local change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the tracked scope (story 16 adds the comments type). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack state changes; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the manager and all listeners (board change / unmount). */
  destroy(): void;
}

export interface UndoOptions {
  /** Milliseconds of pause that ends a typing burst (default UNDO_CAPTURE_TIMEOUT_MS). */
  captureTimeoutMs?: number;
  /** Maximum undo steps to keep (default UNDO_MAX_STEPS). */
  maxSteps?: number;
}

/**
 * Minimal structural views of Yjs internals. These classes (DeleteSet,
 * StackItem) are not re-exported from the yjs namespace in this version, so
 * the guard types them structurally instead.
 */
interface StructStoreLike {
  clients: Map<number, Array<unknown>>;
}
interface DeleteSetLike {
  clients: Map<number, Array<{ clock: number; len: number }>>;
}
interface StackItemLike {
  insertions: DeleteSetLike;
  deletions: DeleteSetLike;
}

/** Walk up from a struct to the key of the top-level object that contains it. */
function topLevelKey(struct: Y.Item, scope: Y.Map<unknown>): string | null {
  let cur: Y.Item = struct;
  let guard = 0;
  while (guard++ < 256) {
    const parent = cur.parent;
    if (parent === scope) return cur.parentSub as string;
    if (!(parent instanceof Y.AbstractType)) return null;
    const parentItem = parent._item;
    if (parentItem === null) return null;
    cur = parentItem;
  }
  return null;
}

/** Every live Item referenced by a DeleteSet (GC'd entries are skipped). */
function structsOf(ds: DeleteSetLike, store: StructStoreLike): Y.Item[] {
  const out: Y.Item[] = [];
  const ranges = ds.clients;
  for (const [cid, clientRanges] of ranges) {
    const column = store.clients.get(cid);
    if (!column) continue;
    for (const r of clientRanges) {
      for (let i = 0; i < r.len; i++) {
        const s = column[r.clock + i];
        if (s instanceof Y.Item) out.push(s);
      }
    }
  }
  return out;
}

/**
 * Whether a stack step can be applied without touching an object that no
 * longer exists. `reinserted` is the DeleteSet whose items this operation
 * re-integrates (undo re-integrates `deletions`, redo re-integrates
 * `insertions`); a top-level object re-integrated there is considered
 * restored and therefore safe to reach into.
 */
function stepIsSafe(
  um: Y.UndoManager,
  step: StackItemLike,
  scope: Y.Map<unknown>,
  reinserted: DeleteSetLike,
): boolean {
  const store = (um.doc as unknown as { store: StructStoreLike }).store;
  const restored = new Set<string>();
  for (const s of structsOf(reinserted, store)) {
    if (s.parent === scope) restored.add(s.parentSub as string);
  }
  const alive = (s: Y.Item): boolean => {
    const key = topLevelKey(s, scope);
    if (key === null) return true;
    return scope.has(key) || restored.has(key);
  };
  for (const s of structsOf(step.insertions, store)) if (!alive(s)) return false;
  for (const s of structsOf(step.deletions, store)) if (!alive(s)) return false;
  return true;
}

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const scope = doc.getMap('objects');

  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };

  const onStackItemAdded = (event: { type: 'undo' | 'redo' }): void => {
    if (event.type !== 'undo') return;
    // Trim the oldest steps once the limit is exceeded (undo.limit).
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    emit();
  };
  const onStackItemPopped = (): void => {
    emit();
  };
  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackItemPopped);

  /**
   * Apply the top of `stack` with `apply`, unless `stepIsSafe` rejects it:
   * a step that only reaches into a since-deleted object is consumed as a
   * no-op (undo.safe) so the rest of the history stays usable.
   */
  const guardedApply = (stack: StackItemLike[], reinserted: 'deletions' | 'insertions', apply: () => boolean): boolean => {
    if (stack.length === 0) return false;
    const top = stack[stack.length - 1];
    let safe = true;
    try {
      safe = stepIsSafe(manager, top, scope, top[reinserted]);
    } catch {
      safe = false;
    }
    if (!safe) {
      stack.pop();
      emit();
      return false;
    }
    return apply();
  };

  return {
    undo: () => guardedApply(manager.undoStack, 'deletions', () => manager.undo() != null),
    redo: () => guardedApply(manager.redoStack, 'insertions', () => manager.redo() != null),
    boundary: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope: (type) => manager.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', onStackItemPopped);
      manager.destroy();
      listeners.clear();
    },
  };
}
