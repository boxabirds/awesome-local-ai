import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean;
  redo(): boolean;
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export interface UndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/**
 * Per-user undo/redo controller wrapping Y.UndoManager.
 * Only LOCAL_ORIGIN transactions are tracked — remote (provider) changes and
 * story 4 load updates are never captured.
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects') as unknown as Y.AbstractType<unknown>;

  const manager = new Y.UndoManager(objectsMap as Y.Map<unknown>, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners: Set<() => void> = new Set();

  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  const handleStackItemAdded = (): void => {
    // Trim the undo stack to maxSteps (remove oldest items from front).
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    notify();
  };

  const handleStackItemPopped = (): void => {
    notify();
  };

  const handleStackItemUpdated = (): void => {
    notify();
  };

  manager.on('stack-item-added', handleStackItemAdded);
  manager.on('stack-item-popped', handleStackItemPopped);
  manager.on('stack-item-updated', handleStackItemUpdated);

  return {
    undo(): boolean {
      if (!manager.canUndo()) return false;
      manager.undo();
      return true;
    },
    redo(): boolean {
      if (!manager.canRedo()) return false;
      manager.redo();
      return true;
    },
    boundary(): void {
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return manager.canUndo();
    },
    canRedo(): boolean {
      return manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      manager.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      listeners.clear();
      manager.off('stack-item-added', handleStackItemAdded);
      manager.off('stack-item-popped', handleStackItemPopped);
      manager.off('stack-item-updated', handleStackItemUpdated);
      manager.destroy();
    },
  };
}
