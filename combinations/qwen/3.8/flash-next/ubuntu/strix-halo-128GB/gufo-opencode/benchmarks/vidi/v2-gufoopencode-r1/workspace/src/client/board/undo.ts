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
  onChange(listener: () => void): () => void;
  destroy(): void;
}

export interface UndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, options: UndoOptions = {}): UndoController {
  const captureTimeout = options.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = options.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout
  });
  const listeners = new Set<() => void>();
  let destroyed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const onStackItemAdded = (event: { type: 'undo' | 'redo' }): void => {
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) {
        manager.undoStack.shift();
      }
    }
    notify();
  };

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', notify);

  return {
    undo(): boolean {
      if (destroyed) return false;
      return manager.undo() != null;
    },
    redo(): boolean {
      if (destroyed) return false;
      return manager.redo() != null;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      return !destroyed && manager.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      manager.addToScope(type);
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', notify);
      manager.destroy();
    }
  };
}
