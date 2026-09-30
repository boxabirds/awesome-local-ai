// Per-person undo history (undo.history): a Y.UndoManager over the board's
// objects that captures only this tab's own LOCAL_ORIGIN transactions, so
// other people's changes (provider origin) and loaded state never enter it.
import * as Y from 'yjs';
import { LOCAL_ORIGIN, getObjectsMap } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverses this person's most recent step; false when there is none. */
  undo(): boolean;
  /** Re-applies the most recently undone step; false when there is none. */
  redo(): boolean;
  /** Closes the current capture window: the next local change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Adds another shared type to the history (story 16 adds comments). */
  addScope(type: Y.AbstractType<any>): void;
  /**
   * True when the next undo (or redo) step changed nothing but `type` (e.g. a
   * burst of typing in one note's text). The text editor uses it so Ctrl/Cmd+Z
   * while editing only undoes typing in that text.
   */
  nextStepOnlyIn(type: Y.AbstractType<any>, stack: 'undo' | 'redo'): boolean;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

/** Stack item meta key: every shared type changed by the step's transactions. */
const CHANGED_TYPES = 'vidi6.changedTypes';

type StackEvent = { stackItem: { meta: Map<unknown, unknown> }; changedParentTypes: Map<Y.AbstractType<Y.YEvent<any>>, unknown> };

function isAncestorOrSelf(candidate: Y.AbstractType<any>, type: Y.AbstractType<any>): boolean {
  let t: Y.AbstractType<any> | null = type;
  while (t) {
    if (t === candidate) return true;
    t = (t._item?.parent as Y.AbstractType<any> | undefined) ?? null;
  }
  return false;
}

export function createUndo(
  doc: Y.Doc,
  opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const { captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS, maxSteps = UNDO_MAX_STEPS } = opts;
  // Capture windows are timed here (Date.now at call time) rather than by the
  // manager, which reads a clock bound at import; the manager itself never
  // closes a window, only stopCapturing() does.
  let lastLocal = 0;
  const manager: Y.UndoManager = new Y.UndoManager(getObjectsMap(doc), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
    captureTransaction: (tr) => {
      if (tr.origin === LOCAL_ORIGIN) {
        const now = Date.now();
        if (lastLocal === 0 || now - lastLocal >= captureTimeoutMs) manager.stopCapturing();
        lastLocal = now;
      }
      return true;
    },
  });
  const listeners = new Set<() => void>();
  let destroyed = false;
  let popping = false;

  const notify = () => {
    if (popping) return;
    for (const cb of [...listeners]) cb();
  };

  const tag = (event: StackEvent) => {
    let types = event.stackItem.meta.get(CHANGED_TYPES) as Set<unknown> | undefined;
    if (!types) {
      types = new Set();
      event.stackItem.meta.set(CHANGED_TYPES, types);
    }
    for (const t of event.changedParentTypes.keys()) types.add(t);
  };

  manager.on('stack-item-added', (event: StackEvent) => {
    tag(event);
    // undo.limit: keep only the most recent steps.
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  });
  manager.on('stack-item-updated', (event: StackEvent) => tag(event));
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  /**
   * Pops exactly one step. Y.UndoManager skips a step whose inverse changes
   * nothing (e.g. a move of a note someone else deleted) and would go on to
   * undo the next one; hiding the older steps meanwhile keeps that step as the
   * one consumed, so nothing visible happens (undo.safe).
   */
  const popOne = (stack: 'undo' | 'redo') => {
    const items = stack === 'undo' ? manager.undoStack : manager.redoStack;
    if (items.length === 0) return false;
    const older = items.splice(0, items.length - 1);
    popping = true;
    try {
      if (stack === 'undo') manager.undo();
      else manager.redo();
    } finally {
      items.unshift(...older);
      popping = false;
    }
    notify();
    return true;
  };

  const top = (stack: 'undo' | 'redo') => {
    const items = stack === 'undo' ? manager.undoStack : manager.redoStack;
    return items[items.length - 1];
  };

  return {
    undo() {
      if (destroyed) return false;
      manager.stopCapturing();
      return popOne('undo');
    },
    redo() {
      if (destroyed) return false;
      manager.stopCapturing();
      return popOne('redo');
    },
    boundary() {
      manager.stopCapturing();
      lastLocal = 0;
    },
    canUndo: () => !destroyed && manager.undoStack.length > 0,
    canRedo: () => !destroyed && manager.redoStack.length > 0,
    addScope(type) {
      manager.addToScope(type as Y.AbstractType<any>);
    },
    nextStepOnlyIn(type, stack) {
      const item = top(stack);
      if (!item) return false;
      const types = item.meta.get(CHANGED_TYPES) as Set<Y.AbstractType<any>> | undefined;
      if (!types || !types.has(type)) return false;
      // Changed parent types also list every ancestor of a changed type.
      return [...types].every((t) => isAncestorOrSelf(t, type));
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
      manager.clear();
      manager.destroy();
      listeners.clear();
    },
  };
}

/** A controller with no history, used before a board's controller exists. */
export const NO_UNDO: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => {},
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => {},
  nextStepOnlyIn: () => false,
  onChange: () => () => {},
  destroy: () => {},
};
