import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * Per-user undo history (story 8, undo.history).
 *
 * One controller per tab, bound to one board doc. It wraps a Yjs
 * `UndoManager` scoped to the `objects` map with `trackedOrigins` limited to
 * this tab's `LOCAL_ORIGIN`: only the transactions THIS person made are
 * captured, so undo/redo never reverses a colleague's change, a story 3 sync
 * relay or a story 4 board load (undo.own).
 *
 * - `undo()` / `redo()` return false on empty stacks. Inverses whose targets a
 *   colleague deleted in the meantime apply to nothing: Yjs never throws, and
 *   the step is consumed as normal (undo.safe).
 * - `boundary()` = `stopCapturing()`: force the next local change into a new
 *   stack item, so each user action (drag, typing session, single mutation)
 *   is exactly one step even when its internal writes run faster than
 *   `captureTimeout` (undo.boundaries).
 * - New local steps clear the redo stack (UndoManager default, undo.redo_cleared).
 * - On every `stack-item-added` the undo stack is trimmed from the front to
 *   `maxSteps` (undo.limit).
 * - History is session-only: `destroy()` disposes the manager and its stacks,
 *   and a fresh controller on the same doc starts empty (undo.session_only).
 * - `addScope` is reserved for future object types (story 16); the `objects`
 *   map is the scope for everything built so far.
 */
export interface UndoController {
  /** Undo the last own step. False when there is nothing to undo. */
  undo(): boolean;
  /** Redo the last undone own step. False when there is nothing to redo. */
  redo(): boolean;
  /** Force the next local change into a new step (step boundary). */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the history's scope (story 16 object types). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes (added / popped / cleared). Returns unsubscribe. */
  onChange(callback: () => void): () => void;
  /** Dispose the controller and drop its stacks. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing-burst merge window. Defaults to UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Maximum undo steps kept. Defaults to UNDO_MAX_STEPS. */
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS,
  });

  let destroyed = false;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };

  const onStackItemAdded = (): void => {
    // undo.limit: keep at most maxSteps; drop the oldest first.
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    emit();
  };
  const onStackItemPopped = (): void => emit();

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackItemPopped);

  // Always notify after undo()/redo(), not just on Yjs stack events: a no-op
  // inverse (its target a colleague deleted) drains the stack but fires no
  // `stack-item-popped`, so the buttons would otherwise stay stale (undo.ui).
  const undo = (): boolean => {
    if (destroyed) return false;
    const applied = manager.undo() != null;
    emit();
    return applied;
  };
  const redo = (): boolean => {
    if (destroyed) return false;
    const applied = manager.redo() != null;
    emit();
    return applied;
  };

  return {
    undo,
    redo,
    boundary: () => {
      if (!destroyed) manager.stopCapturing();
    },
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope: (type) => {
      if (!destroyed) manager.addToScope(type);
    },
    onChange: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      manager.destroy();
    },
  };
}
