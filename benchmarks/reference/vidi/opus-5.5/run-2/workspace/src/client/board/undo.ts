/**
 * Per-person undo history (anchor: undo.history). A Y.UndoManager over the objects map that
 * tracks only this tab's LOCAL_ORIGIN transactions, so other people's changes (provider
 * origin) and story 4 load updates never enter the stacks and are never reversed.
 *
 * - Local transactions less than `captureTimeoutMs` apart merge into one step (typing
 *   bursts); `boundary()` closes the current step (gesture, edit and command boundaries).
 * - `startGroup()` keeps one step open regardless of pauses until the next `boundary()`
 *   (a drag held still for a while is still one step).
 * - Each undo/redo reverses exactly one step. A step whose targets were deleted by someone
 *   else has no effect and is consumed; it never recreates content and never throws.
 * - New local steps clear redo (UndoManager default); the undo stack keeps `maxSteps`.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean; // false when stack empty
  redo(): boolean; // false when stack empty
  boundary(): void; // close the current capture window
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<any>): void; // story 16 adds comments
  onChange(cb: () => void): () => void;
  destroy(): void;
  /** Opens a step that stays open (whatever the pauses) until the next `boundary()`. */
  startGroup(): void;
  /**
   * Undoes the last step only if it changed nothing but `type` (typing while editing) and
   * the optional `also` types (story 9: the text object's stored box).
   */
  undoIn(type: Y.AbstractType<any>, ...also: Y.AbstractType<any>[]): boolean;
  /** Redoes the last undone step only if it changes nothing but `type` (and `also`). */
  redoIn(type: Y.AbstractType<any>, ...also: Y.AbstractType<any>[]): boolean;
  /** Number of steps on the undo stack (tests). */
  undoSize(): number;
  /**
   * Runs `fn` so that its changes join the most recent step (story 9: an empty text removed
   * when editing ends). A step left without net effect (text created and abandoned) is
   * dropped, so Undo never spends a press on nothing.
   */
  amendLast(fn: () => void): void;
}

export interface UndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/** StackItem meta key: the set of types a step changed. */
const TARGETS = 'vidi6.targets';

type StackItemEvent = {
  stackItem: { meta: Map<unknown, unknown> };
  changedParentTypes: Map<Y.AbstractType<Y.YEvent<any>>, Y.YEvent<any>[]>;
};

type DeleteSet = ReturnType<typeof Y.createDeleteSetFromStructStore>;

/** True when undoing `item` would change nothing: all it inserted is gone and it removed only its own insertions. */
function hasNoEffect(doc: Y.Doc, item: { insertions: DeleteSet; deletions: DeleteSet }): boolean {
  const deletedNow = Y.createDeleteSetFromStructStore(doc.store);
  const every = (ds: DeleteSet, test: (id: Y.ID) => boolean): boolean => {
    for (const [client, ranges] of ds.clients) {
      for (const r of ranges) {
        for (let clock = r.clock; clock < r.clock + r.len; clock += 1) {
          if (!test(Y.createID(client, clock))) return false;
        }
      }
    }
    return true;
  };
  return (
    every(item.insertions, (id) => Y.isDeleted(deletedNow, id)) &&
    every(item.deletions, (id) => Y.isDeleted(item.insertions, id))
  );
}

function changedTargets(event: StackItemEvent): Set<unknown> {
  const targets = new Set<unknown>();
  event.changedParentTypes.forEach((events) => events.forEach((e) => targets.add(e.target)));
  return targets;
}

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const um = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout,
  });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  let destroyed = false;

  const tag = (event: StackItemEvent, added: boolean) => {
    const meta = event.stackItem.meta;
    const previous = added ? undefined : (meta.get(TARGETS) as Set<unknown> | undefined);
    meta.set(TARGETS, new Set([...(previous ?? []), ...changedTargets(event)]));
  };
  um.on('stack-item-added', (event: StackItemEvent) => {
    tag(event, true);
    while (um.undoStack.length > maxSteps) um.undoStack.shift();
    notify();
  });
  um.on('stack-item-updated', (event: StackItemEvent) => tag(event, false));
  um.on('stack-item-popped', notify);
  um.on('stack-cleared', notify);

  /** Pops exactly one step: a step with no effect is consumed instead of reaching further back. */
  const popOne = (kind: 'undo' | 'redo', only?: readonly Y.AbstractType<any>[]): boolean => {
    if (destroyed) return false;
    const stack = kind === 'undo' ? um.undoStack : um.redoStack;
    const top = stack[stack.length - 1];
    if (top === undefined) return false;
    if (only !== undefined) {
      const targets = top.meta.get(TARGETS) as Set<unknown> | undefined;
      if (targets === undefined || targets.size === 0 || [...targets].some((t) => !only.includes(t as Y.AbstractType<any>))) {
        return false;
      }
    }
    const earlier = stack.splice(0, stack.length - 1);
    try {
      if (kind === 'undo') um.undo();
      else um.redo();
    } finally {
      stack.unshift(...earlier);
    }
    um.captureTimeout = captureTimeout;
    um.stopCapturing(); // what follows never merges into a step the user moved past
    notify();
    return true;
  };

  return {
    undo: () => popOne('undo'),
    redo: () => popOne('redo'),
    undoIn: (type, ...also) => popOne('undo', [type, ...also]),
    redoIn: (type, ...also) => popOne('redo', [type, ...also]),
    boundary() {
      um.captureTimeout = captureTimeout;
      um.stopCapturing();
    },
    startGroup() {
      um.stopCapturing();
      um.captureTimeout = Number.POSITIVE_INFINITY;
    },
    canUndo: () => !destroyed && um.undoStack.length > 0,
    canRedo: () => !destroyed && um.redoStack.length > 0,
    undoSize: () => um.undoStack.length,
    amendLast(fn) {
      if (destroyed) {
        fn();
        return;
      }
      const before = um.undoStack.length;
      if (before > 0) {
        // Any positive lastChange with an infinite timeout merges the next change into the top step.
        um.lastChange = 1;
        um.captureTimeout = Number.POSITIVE_INFINITY;
      }
      try {
        fn();
      } finally {
        um.captureTimeout = captureTimeout;
        um.stopCapturing();
      }
      const top = um.undoStack[um.undoStack.length - 1];
      if (top !== undefined && um.undoStack.length === before && hasNoEffect(doc, top)) {
        um.undoStack.pop();
        notify();
      }
    },
    addScope(type) {
      um.addToScope(type);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      um.destroy();
      notify();
      listeners.clear();
    },
  };
}
