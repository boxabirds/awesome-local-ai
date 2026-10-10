// Per-tab undo history over the objects map (undo.history). Wraps
// Y.UndoManager with trackedOrigins = {LOCAL_ORIGIN}: only this tab's own
// transactions are captured, so remote changes (provider origin) and story 4
// load updates (LOAD_ORIGIN) never enter the stacks and can never be undone.
// History lives in memory only; a fresh controller starts empty (session
// only, undo.session_only).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean;
  redo(): boolean;
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  // Mirrors UndoManager.addToScope's `AbstractType<any>`: the container type
  // parameter is invariant in the yjs types, so `any` is what composes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addScope(type: Y.AbstractType<any>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export function createUndo(
  doc: Y.Doc,
  opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS,
  });
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };
  const onStackEvent = (event: { type: 'undo' | 'redo' }): void => {
    // undo.limit: cap the undo stack at maxSteps by dropping the oldest
    // steps. The structs pinned by a dropped item stay pinned until the doc
    // is destroyed — a bounded memory cost, noted in NOTES.md.
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  };
  manager.on('stack-item-added', onStackEvent);
  manager.on('stack-item-popped', onStackEvent);

  let destroyed = false;
  const run = (kind: 'undo' | 'redo'): boolean => {
    if (destroyed) return false;
    // An inverse targeting an item deleted remotely is consumed by Yjs with
    // no effect and no throw (undo.safe); `applied` only reports outcome.
    const applied = (kind === 'undo' ? manager.undo() : manager.redo()) !== null;
    if (!applied) notify(); // stack-item-popped never fires for a no-op
    return applied;
  };

  return {
    undo: () => run('undo'),
    redo: () => run('redo'),
    boundary(): void {
      if (!destroyed) manager.stopCapturing();
    },
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope(type: Y.AbstractType<any>): void {
      if (!destroyed) manager.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      if (destroyed) return () => undefined;
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // ObservableV2.destroy() only drops the manager's own listeners; the
      // doc-level listeners registered by the constructor must go too.
      doc.off('afterTransaction', manager.afterTransactionHandler);
      doc.off('destroy', manager.destroy);
      manager.destroy();
      listeners.clear();
    },
  };
}
