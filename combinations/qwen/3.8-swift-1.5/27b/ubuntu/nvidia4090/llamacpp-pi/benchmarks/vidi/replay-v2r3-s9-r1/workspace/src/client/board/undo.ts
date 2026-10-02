/**
 * Per-client undo/redo for the local user (story 8).
 *
 * Wraps a `Y.UndoManager` scoped to the `objects` map so that:
 *  - only transactions performed locally (origin `LOCAL_ORIGIN`) are tracked;
 *    everything that arrives from the network — peers, a full snapshot load,
 *    server compaction — is invisible to the history (PRD undo.isolation,
 *    undo.sync_independence);
 *  - `boundary()` (a deliberate `stopCapturing`) makes one meaningful action
 *    — create, a drag/resize gesture, an edit session, delete, color — one
 *    undo step, while sub-steps inside an action merge within the capture
 *    window (PRD undo.history, undo.boundaries).
 *
 * The controller is created once per board doc, lives for the editing session
 * (never persisted), and is destroyed on board change / unmount (PRD
 * undo.history "at least the current session").
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/** The contract the UI (shortcuts, buttons, boundaries) depends on. */
export interface UndoController {
  /** Undo one step. Returns `false` when there is nothing to undo. */
  undo(): boolean;
  /** Redo one step. Returns `false` when there is nothing to redo. */
  redo(): boolean;
  /**
   * Delimit an undo step: the next local transaction starts a new step even
   * within the capture window. Safe to call on an empty history (no-op).
   */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Track an additional Y type in this history (PRD undo.types). Sticky notes
   * live in the `objects` map, which the manager already scopes, so the app
   * does not call this today; it exists for future object types.
   */
  addScope(type: Y.AbstractType<unknown>): void;
  /**
   * Subscribe to history changes (a step added, undone, redone, merged).
   * Returns an unsubscribe function.
   */
  onChange(cb: () => void): () => void;
  /** Stop tracking and release the manager. Safe to call twice. */
  destroy(): void;
}

export interface CreateUndoOpts {
  /** Capture window in ms; defaults to `UNDO_CAPTURE_TIMEOUT_MS`. */
  captureTimeoutMs?: number;
  /** Step cap (oldest discarded first); defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts: CreateUndoOpts = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });
  let destroyed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    if (destroyed) return;
    for (const listener of [...listeners]) listener();
  };
  const onAdded = () => {
    // PRD undo.history: keep at most `maxSteps` steps, discard the oldest.
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  };
  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-updated', notify);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);
  return {
    undo() {
      return !destroyed && manager.undo() !== null;
    },
    redo() {
      return !destroyed && manager.redo() !== null;
    },
    boundary() {
      if (!destroyed) manager.stopCapturing();
    },
    canUndo() {
      return !destroyed && manager.canUndo();
    },
    canRedo() {
      return !destroyed && manager.canRedo();
    },
    addScope(type) {
      if (!destroyed) manager.addToScope(type);
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
      manager.off('stack-item-added', onAdded);
      manager.off('stack-item-updated', notify);
      manager.off('stack-item-popped', notify);
      manager.off('stack-cleared', notify);
      manager.destroy();
    },
  };
}
