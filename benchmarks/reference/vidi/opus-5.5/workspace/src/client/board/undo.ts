/**
 * Per-person undo history (story 8) over the board document.
 *
 * A `Y.UndoManager` over the `objects` map that tracks only `LOCAL_ORIGIN` transactions: only
 * this tab's own changes enter its stacks. Remote changes (the provider's origin) and saved
 * state loaded by the room (story 4's LOAD_ORIGIN) are never captured, so undo never reverses
 * anyone else's work (undo.own). Undo and redo apply inverse operations as a new transaction
 * that syncs to everyone like any other change.
 *
 * Steps: transactions closer together than the capture timeout merge (typing bursts);
 * `boundary()` closes the current step so separate actions never merge; `beginGesture()` /
 * `endGesture()` keep a whole drag or resize in one step even when the pointer is held still
 * longer than the capture timeout.
 *
 * Framework-free; the React binding is useUndo.ts. History lives in memory only.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

const OBJECTS_KEY = 'objects';

export interface UndoController {
  /** Undoes this person's most recent step. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the most recently undone step. False when there is nothing to redo. */
  redo(): boolean;
  /** Closes the current capture window: the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Tracks another shared type (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Called after the stacks change; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Stops tracking and forgets the history. Idempotent. */
  destroy(): void;
  /** Starts a gesture: one step until endGesture, however long the pointer pauses. */
  beginGesture(): void;
  /** Ends a gesture: restores timeout grouping and closes the step. */
  endGesture(): void;
  /** Identity of the newest undo step (null when empty); stable until that step is undone or dropped. */
  lastStep(): object | null;
}

export interface UndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/** The parts of a keyboard event undoKey reads. */
export type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

export type UndoKey = 'undo' | 'redo' | null;

/** Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z and Ctrl+Y → redo (undo.shortcuts). */
export function undoKey(e: KeyLike): UndoKey {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.shiftKey) return 'redo';
  return null;
}

type StackName = 'undoStack' | 'redoStack';

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const listeners = new Set<() => void>();
  let destroyed = false;
  let inGesture = false;
  /** Date.now() of this person's last tracked change. */
  let lastLocalChange = 0;
  // Grouping by time is done here, not by Y.UndoManager's own captureTimeout: Yjs reads the
  // clock through a Date.now reference taken when lib0 loads, which fake clocks cannot control,
  // and a gesture must never be split by a pause. The manager itself merges until told to stop.
  const manager: Y.UndoManager = new Y.UndoManager(doc.getMap(OBJECTS_KEY), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: Number.POSITIVE_INFINITY,
    captureTransaction: (tr) => {
      if (tr.origin === LOCAL_ORIGIN && manager.scope.some((t) => tr.changedParentTypes.has(t as never))) {
        const now = Date.now();
        if (!inGesture && now - lastLocalChange >= captureTimeout) manager.stopCapturing();
        lastLocalChange = now;
      }
      return true;
    },
  });
  /** True while undo()/redo() run: notifications wait until the stacks are consistent again. */
  let popping = false;

  const notify = () => {
    if (popping) return;
    for (const cb of [...listeners]) cb();
  };

  const onAdded = (event: { type: 'undo' | 'redo' }) => {
    if (event.type === 'undo') {
      // undo.limit: keep the most recent maxSteps steps.
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  };
  manager.on('stack-item-added', onAdded);
  manager.on('stack-cleared', notify);

  /**
   * Pops exactly one step. Y.UndoManager keeps popping while a step has no effect (e.g. a move
   * of an object someone else deleted), which would also undo the step below it in the same
   * press; the PRD wants that press to change nothing visible (undo.safe). So only the top step
   * is exposed to the manager, and the rest of the stack is put back afterwards.
   */
  const popOne = (name: StackName, run: () => unknown): boolean => {
    if (destroyed || manager[name].length === 0) return false;
    const rest = manager[name].slice(0, -1);
    manager[name] = manager[name].slice(-1);
    popping = true;
    try {
      run();
    } finally {
      manager[name] = rest.concat(manager[name]);
      popping = false;
    }
    notify();
    return true;
  };

  return {
    undo: () => popOne('undoStack', () => manager.undo()),
    redo: () => popOne('redoStack', () => manager.redo()),
    boundary: () => manager.stopCapturing(),
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope: (type) => manager.addToScope(type),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      manager.off('stack-item-added', onAdded);
      manager.off('stack-cleared', notify);
      manager.destroy();
      manager.undoStack = [];
      manager.redoStack = [];
      notify();
      listeners.clear();
    },
    beginGesture() {
      manager.stopCapturing();
      inGesture = true;
    },
    endGesture() {
      inGesture = false;
      manager.stopCapturing();
    },
    lastStep: () => (destroyed ? null : (manager.undoStack[manager.undoStack.length - 1] ?? null)),
  };
}
