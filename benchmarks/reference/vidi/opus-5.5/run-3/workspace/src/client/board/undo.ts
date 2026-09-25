// Personal undo history (undo.history). One controller per board doc per tab, memory only.
//
// Only this tab's own transactions (LOCAL_ORIGIN) are captured, so other people's changes (provider origin)
// and the story 4 load never enter the stacks and are never reversed. Undo and redo apply inverse operations
// with the UndoManager as origin; they sync like any other change.
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undoes this person's most recent step. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the most recently undone step. False when there is nothing to redo. */
  redo(): boolean;
  /** Closes the current capture window: the next local change starts a new step. */
  boundary(): void;
  /**
   * Closes the current capture window and keeps the next step open, however long the pauses, until the
   * next `boundary()`. Used by gestures, so a drag held still for a while is still one step.
   */
  beginStep(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Identity of the step on top of the undo (redo) stack, or null when empty. Lets the text editor limit
   *  its own undo to the typing done since editing started. */
  topUndo(): object | null;
  topRedo(): object | null;
  /** Brings another shared type (story 16: comments) under the same history. `any`: a Y.Map or Y.Array is
   *  not assignable to `AbstractType<unknown>` (its event type is invariant). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addScope(type: Y.AbstractType<any>): void;
  /**
   * Runs `change` so that it and every step above `mark` on the undo stack (`mark` itself too with `including`)
   * become one step, whatever the pauses or boundaries between them. `mark` null means the bottom of the stack.
   * A joined step that no longer has any effect (it created and removed the same things) is dropped. Story 9 uses
   * it to remove an abandoned empty text together with its creation or with the edit that emptied it, so undo
   * never brings back an empty text.
   */
  joinSince<T>(mark: object | null, change: () => T, opts?: { including?: boolean }): T;
  /** Whether the step on top of the undo stack created `type` (e.g. an object's Y.Map). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topStepCreated(type: Y.AbstractType<any>): boolean;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

type DeleteSetLike = { clients: Map<number, Array<{ clock: number; len: number }>> };

/** Whether every range in `inner` lies inside `outer` (both as Yjs keeps them: sorted, merged ranges). */
function coveredBy(inner: DeleteSetLike, outer: DeleteSetLike): boolean {
  for (const [client, ranges] of inner.clients) {
    const cover = outer.clients.get(client) ?? [];
    for (const r of ranges) {
      if (!cover.some((c) => c.clock <= r.clock && r.clock + r.len <= c.clock + c.len)) return false;
    }
  }
  return true;
}

export function createUndo(doc: Y.Doc, opts: { captureTimeoutMs?: number; maxSteps?: number } = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  // The capture window is timed here rather than by Y.UndoManager (whose clock is fixed at import), so a
  // step's end is decided by the same clock as the rest of the app. This handler is registered before the
  // UndoManager's, so it runs first for every transaction.
  let lastLocalChange = 0;
  let holding = false;
  let joining = false;
  const onAfterTransaction = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    const now = Date.now();
    if (!holding && !joining && now - lastLocalChange >= captureTimeout) um.stopCapturing();
    lastLocalChange = now;
  };
  doc.on('afterTransaction', onAfterTransaction);
  const um = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: Number.POSITIVE_INFINITY,
  });
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  um.on('stack-item-added', (event: { type: 'undo' | 'redo' }) => {
    if (event.type === 'undo' && um.undoStack.length > maxSteps) {
      um.undoStack.splice(0, um.undoStack.length - maxSteps);
    }
    emit();
  });
  um.on('stack-item-popped', emit);
  um.on('stack-cleared', emit);

  /**
   * Applies exactly one step. Y.UndoManager on its own keeps popping while a step has no effect (its target
   * was deleted by someone else), which would silently undo an older step too; the older steps are hidden
   * while it runs, so a step without effect is simply consumed (undo.safe).
   */
  const step = (stack: Y.UndoManager['undoStack'], run: () => unknown): boolean => {
    if (stack.length === 0) return false;
    const older = stack.splice(0, stack.length - 1);
    try {
      run();
    } finally {
      stack.unshift(...older);
    }
    um.stopCapturing();
    emit();
    return true;
  };

  const boundary = () => {
    holding = false;
    um.stopCapturing();
  };

  return {
    undo: () => step(um.undoStack, () => um.undo()),
    redo: () => step(um.redoStack, () => um.redo()),
    boundary,
    beginStep() {
      boundary();
      holding = true;
    },
    canUndo: () => um.undoStack.length > 0,
    canRedo: () => um.redoStack.length > 0,
    topUndo: () => um.undoStack[um.undoStack.length - 1] ?? null,
    topRedo: () => um.redoStack[um.redoStack.length - 1] ?? null,
    addScope: (type) => um.addToScope(type),
    joinSince(mark, change, opts = {}) {
      const stack = um.undoStack;
      const at = mark === null ? -1 : stack.indexOf(mark as (typeof stack)[number]);
      const first = mark === null ? 0 : at < 0 ? 0 : opts.including ? at : at + 1;
      if (first >= stack.length) return change();
      const target = stack[first];
      for (const item of stack.splice(first + 1)) {
        target.insertions = Y.mergeDeleteSets([target.insertions, item.insertions]);
        target.deletions = Y.mergeDeleteSets([target.deletions, item.deletions]);
      }
      joining = true;
      // Any positive lastChange makes Y.UndoManager (infinite captureTimeout) merge into the top step.
      um.lastChange = Math.max(1, um.lastChange);
      try {
        return change();
      } finally {
        joining = false;
        um.stopCapturing();
        if (stack[stack.length - 1] === target && coveredBy(target.deletions, target.insertions)) stack.pop();
        emit();
      }
    },
    topStepCreated(type) {
      const top = um.undoStack[um.undoStack.length - 1];
      const item = type._item;
      return !!top && !!item && Y.isDeleted(top.insertions, item.id);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      listeners.clear();
      doc.off('afterTransaction', onAfterTransaction);
      um.clear();
      um.destroy();
    },
  };
}

/** A controller with no history, used before the real one exists. */
export const NO_UNDO: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary() {},
  beginStep() {},
  canUndo: () => false,
  canRedo: () => false,
  topUndo: () => null,
  topRedo: () => null,
  addScope() {},
  joinSince: (_mark, change) => change(),
  topStepCreated: () => false,
  onChange: () => () => {},
  destroy() {},
};
