import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

// Anything yjs accepts as an undo scope: a shared type or the whole doc.
export type UndoScope = Y.AbstractType<any> | Y.Doc;

export interface UndoController {
  // False when the stack is empty (or when every candidate step had no
  // effect, e.g. an inverse targeting an item deleted remotely).
  undo(): boolean;
  redo(): boolean;
  // Close the current capture window: the next local change starts a new step.
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  // Story 16 adds the comments map; history is preserved.
  addScope(scope: UndoScope): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export interface UndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

// Per-tab undo history over the objects map. Only transactions tagged with
// LOCAL_ORIGIN are captured, so remote (provider origin) and story 4 load
// updates never enter the stacks and can never be undone from this tab.
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of Array.from(listeners)) cb();
  };

  manager.on('stack-item-added', (event) => {
    // Trimming is only about this tab's own undo history (undo.limit).
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  });
  manager.on('stack-item-popped', () => notify());

  let destroyed = false;

  return {
    undo(): boolean {
      if (destroyed) return false;
      // A step whose inverse has no effect is consumed silently by Yjs and
      // pops no event, so notify unconditionally.
      const performed = manager.undo() !== null;
      notify();
      return performed;
    },
    redo(): boolean {
      if (destroyed) return false;
      const performed = manager.redo() !== null;
      notify();
      return performed;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.canUndo();
    },
    canRedo(): boolean {
      return !destroyed && manager.canRedo();
    },
    addScope(scope: UndoScope): void {
      if (destroyed) return;
      manager.addToScope(scope);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      manager.destroy();
    }
  };
}
