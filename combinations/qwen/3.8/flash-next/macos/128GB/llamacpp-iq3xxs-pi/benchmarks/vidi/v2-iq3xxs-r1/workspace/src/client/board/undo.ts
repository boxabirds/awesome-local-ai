import * as Y from 'yjs';
import { LOCAL_ORIGIN, OBJECTS_MAP } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * One person's undo history for one board (PRD undo.own).
 *
 * Everything about it is local to this tab: the stacks hold only the transactions
 * this tab made, undo and redo apply the inverse of one step, and the whole thing is
 * thrown away when the board is left or the page reloaded (PRD undo.session_only).
 */
export interface UndoController {
  /** Reverse this person's most recent change. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change. False when there is nothing to redo. */
  redo(): boolean;
  /** Close the current capture window: the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Put another shared type under the history (story 16 adds `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Called after any change to the stacks; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Throw the history away (board change / unmount). */
  destroy(): void;
}

export interface UndoKeyCombo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Which undo step a key combination asks for, or null when the keys are somebody
 * else's business (plain `z`, `Alt+Z`, …). One place so the board shortcuts and the
 * note editor cannot drift apart (PRD undo.shortcuts).
 */
export function undoStepFor(event: UndoKeyCombo): 'undo' | 'redo' | null {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier || event.altKey) return null;
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  // Windows/Linux convention.
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

export interface CreateUndoOptions {
  /** Typing pause that ends one step (default `UNDO_CAPTURE_TIMEOUT_MS`). */
  captureTimeoutMs?: number;
  /** Steps kept per stack (default `UNDO_MAX_STEPS`). */
  maxSteps?: number;
}

/**
 * Build this tab's history over the board's objects (design decision 1: *origin*
 * filtering, not user filtering).
 *
 * Only transactions carrying `LOCAL_ORIGIN` — the origin every write in
 * `board-model` uses — enter the stacks. Live changes arrive with the websocket
 * provider as their origin and a saved board arrives with the load origin, so a
 * colleague's work is never in reach of this tab's undo, and neither is content
 * this tab merely received (PRD undo.own).
 *
 * Steps are the transactions themselves, merged while they fall inside
 * `captureTimeoutMs` of each other; `boundary()` closes that window so a drag, a
 * resize or an edit never merges with whatever came before or after it.
 */
export function createUndo(doc: Y.Doc, opts: CreateUndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const scope: Y.Map<unknown> = doc.getMap(OBJECTS_MAP);

  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  let destroyed = false;

  /**
   * Keep the undo stack at `maxSteps` (PRD undo.limit): the *oldest* step leaves,
   * and with it the right to reverse work that old.
   */
  const trim = ({ type }: { type: 'undo' | 'redo' }): void => {
    if (type !== 'undo' || destroyed) return;
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onStackItemAdded = (event: { type: 'undo' | 'redo' }): void => trim(event);

  manager.on('stack-item-added', onStackItemAdded);

  const events = ['stack-item-added', 'stack-item-popped', 'stack-item-updated', 'stack-cleared'] as const;

  return {
    undo(): boolean {
      if (destroyed) return false;
      // Whatever window was open belongs to the past: close it before stepping back,
      // so the inverse cannot be merged into a later change.
      manager.stopCapturing();
      return manager.undo() !== null;
    },
    redo(): boolean {
      if (destroyed) return false;
      manager.stopCapturing();
      return manager.redo() !== null;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope(type: Y.AbstractType<unknown>): void {
      if (!destroyed) manager.addToScope(type as Y.AbstractType<Y.YEvent<any>>);
    },
    onChange(cb: () => void): () => void {
      const notify = (): void => {
        if (!destroyed) cb();
      };
      for (const name of events) manager.on(name, notify);
      return () => {
        for (const name of events) manager.off(name, notify);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      manager.off('stack-item-added', onStackItemAdded);
      manager.destroy();
    },
  };
}
