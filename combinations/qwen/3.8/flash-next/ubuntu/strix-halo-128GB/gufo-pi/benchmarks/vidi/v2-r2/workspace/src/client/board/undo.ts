import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@shared/config';

export interface UndoController {
  undo(): boolean;
  redo(): boolean;
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
  /** Exposed for testing: the internal Y.UndoManager. */
  readonly _um: Y.UndoManager;
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects') as unknown as Y.AbstractType<any>;
  const scope: Y.AbstractType<any>[] = [objectsMap];

  const um = new Y.UndoManager(scope, {
    trackedOrigins: new Set([LOCAL_ORIGIN as unknown]),
    captureTimeout,
  });

  const listeners = new Set<() => void>();

  const fireChange = () => {
    for (const cb of listeners) cb();
  };

  const addItemObserver = () => {
    // Trim undo stack to maxSteps
    while (um.undoStack.length > maxSteps) {
      (um.undoStack as unknown[]).shift();
    }
    fireChange();
  };

  um.on('stack-item-added', addItemObserver);
  um.on('stack-item-popped', fireChange);
  um.on('stack-item-updated', fireChange);
  um.on('stack-cleared', fireChange);

  return {
    undo(): boolean {
      if (um.undoStack.length === 0) return false;
      um.undo();
      return true;
    },
    redo(): boolean {
      if (um.redoStack.length === 0) return false;
      um.redo();
      return true;
    },
    boundary(): void {
      um.stopCapturing();
    },
    canUndo(): boolean {
      return um.undoStack.length > 0;
    },
    canRedo(): boolean {
      return um.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      scope.push(type as Y.AbstractType<any>);
      um.addToScope(type as unknown as Y.AbstractType<any>);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy(): void {
      um.off('stack-item-added', addItemObserver);
      um.off('stack-item-popped', fireChange);
      um.off('stack-item-updated', fireChange);
      um.off('stack-cleared', fireChange);
      listeners.clear();
      um.destroy();
    },
    _um: um,
  };
}
