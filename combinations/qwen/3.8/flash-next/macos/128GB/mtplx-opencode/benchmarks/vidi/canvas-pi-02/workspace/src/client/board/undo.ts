/**
 * The per-person undo history (story 8, design "the one mechanism").
 *
 * One Yjs `UndoManager` per browser over the shared `objects` map, tracking
 * only transactions whose origin is `LOCAL_ORIGIN` — remote updates arrive
 * with the provider as their origin and are never captured, which is what
 * makes "undo only my own changes" a property of the document, not of the
 * interface.
 *
 * The controller adds the two things the raw manager leaves to the app:
 *
 *  - a 200-step cap (`undo.limit`): when a new step would overflow the
 *    undo stack, the oldest step falls off the front;
 *  - a change notification (`onChange`), so the buttons can show whether the
 *    stacks are empty and refresh after every undo, redo and new step.
 *
 * `undo()` and `redo()` never throw: undoing a change whose objects were
 * deleted remotely is a no-op, not an error (design D3).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoControllerOptions {
  /** Grouping window; defaults to `UNDO_CAPTURE_TIMEOUT_MS`. For tests. */
  captureTimeoutMs?: number;
  /** History cap; defaults to `UNDO_MAX_STEPS` (`undo.limit`). For tests. */
  maxSteps?: number;
}

export interface UndoController {
  /** Pop one step off the undo stack. False when empty or nothing applied. */
  undo(): boolean;
  redo(): boolean;
  /** End the current capture group: the next local change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Current stack lengths, newest last. For tests and the debug readout. */
  stackSize(): { undo: number; redo: number };
  /** Extend the undo scope (story 16 will add non-sticky types through here). */
  addScope(type: Y.AbstractType<unknown>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export function createUndo(
  doc: Y.Doc,
  options: UndoControllerOptions = {},
): UndoController {
  const captureTimeoutMs = options.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = options.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap('objects'), {
    // Only my own transactions: `null` (the default origin) stays untracked,
    // so seeding a document or applying a server snapshot is never undoable.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const onStackChanged = (event: { type: 'undo' | 'redo' }): void => {
    // `undo.limit`: the manager pushes unbounded; trim the front here. Only
    // additions to the undo stack need trimming — a 'redo' event is a push
    // onto the redo stack, which stays the size the session's undos made it.
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) {
        manager.undoStack.shift();
      }
    }
    notify();
  };

  let destroyed = false;

  const onEvent = onStackChanged;
  manager.on('stack-item-added', onEvent);
  manager.on('stack-item-updated', onEvent);
  manager.on('stack-item-popped', onEvent);
  manager.on('stack-cleared', notify);

  return {
    undo() {
      if (destroyed) return false;
      try {
        // Yjs never *re-dels* an item whose parent was deleted remotely; and
        // when an undo step has nothing left to give, the manager drains it
        // and reports nothing applied. Either way: no throw, history usable.
        const applied = manager.undo() !== null;
        notify();
        return applied;
      } catch {
        // A undo whose targets were deleted remotely must never throw.
        notify();
        return false;
      }
    },
    redo() {
      if (destroyed) return false;
      try {
        const applied = manager.redo() !== null;
        notify();
        return applied;
      } catch {
        notify();
        return false;
      }
    },
    boundary() {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo() {
      return !destroyed && manager.canUndo();
    },
    canRedo() {
      return !destroyed && manager.canRedo();
    },
    stackSize() {
      if (destroyed) return { undo: 0, redo: 0 };
      return { undo: manager.undoStack.length, redo: manager.redoStack.length };
    },
    addScope(type) {
      if (destroyed) return;
      manager.addToScope(type);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      // Removes the doc's `afterTransaction` and `destroy` listeners.
      manager.destroy();
    },
  };
}
