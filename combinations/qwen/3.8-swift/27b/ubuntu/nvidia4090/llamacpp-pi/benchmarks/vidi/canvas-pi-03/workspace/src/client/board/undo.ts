/**
 * Story 8: per-user undo/redo (undo.history).
 *
 * `createUndo(doc)` wraps `Y.UndoManager` over the objects map, tracking ONLY
 * `LOCAL_ORIGIN` transactions (key decision 1: origin filtering, not user
 * filtering). Every local mutation in this tab runs in a `doc.transact(fn,
 * LOCAL_ORIGIN)` (story 2/7 board-model), while remote updates arrive with
 * the provider origin and story 4 loads with the server origin — so this
 * tab's undo/redo stacks contain exclusively this person's own changes, and
 * undoing can never reverse a colleague's work (undo.own).
 *
 * Undo/redo apply their inverse operations as new transactions whose origin
 * is the UndoManager (not LOCAL_ORIGIN), so they sync to every other client
 * like any other change (undo.safe).
 *
 * undo.safe in practice: an inverse targeting a structure that was deleted
 * REMOTELY in the meantime is not a harmless no-op in Yjs — `popStackItem`
 * loops while a popped step performs no change, so it cascades into OLDER
 * steps and applies them (undoing a move of a note someone deleted can
 * delete other notes, unit TC-07). The controller guards every undo/redo
 * with a pre-check: if the step touches a board object that no longer
 * exists and this step did not delete it, the step is discarded without
 * applying (no-op, `false`). A post-check then verifies that only objects
 * the step itself created/deleted/touched changed.
 *
 * Step boundaries (undo.boundaries): `captureTimeout`
 * (UNDO_CAPTURE_TIMEOUT_MS) merges transactions that follow quickly — one
 * typing burst, one drag's rAF frames — while `boundary()`
 * (`stopCapturing()`) closes the window at gesture and edit edges so one
 * action is exactly one step.
 *
 * The history is per tab, in memory only: a fresh controller (page reload,
 * board change) starts empty (undo.session_only), and the undo stack is
 * trimmed to `maxSteps` (UNDO_MAX_STEPS) on every add (undo.limit).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from 'src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from 'src/shared/config';

export interface UndoController {
  /**
   * Apply the inverse of the last own step. Returns false when the stack is
   * empty or the step could not be applied (its targets were deleted in the
   * meantime — the step is consumed, the board is untouched).
   */
  undo(): boolean;
  /** Re-apply the last undone step; false when the redo stack is empty or the step cannot be applied. */
  redo(): boolean;
  /** Close the current capture window so the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the scope (story 16 adds the comments map). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Number of steps on the undo stack (test seam for undo.limit). */
  stackLength(): number;
  /** Dispose the manager; history is discarded (session-only). */
  destroy(): void;
}

/** The board object ids a stack item refers to. */
function stepObjectIds(
  doc: Y.Doc,
  stackItem: Y.UndoManager['undoStack'][number],
): { touched: Set<string>; created: Set<string>; deleted: Set<string> } {
  const objects = doc.getMap('objects');
  const touched = new Set<string>();
  const created = new Set<string>();
  const deleted = new Set<string>();

  /** Walk up from a struct to the objects-map entry of its board object. */
  const objectIdOf = (item: Y.Item): string | null => {
    let cur: Y.Item | null = item;
    while (cur != null) {
      const parent: Y.AbstractType<unknown> | Y.Doc | Y.ID | null = cur.parent;
      if (parent === objects) {
        return typeof cur.parentSub === 'string' ? cur.parentSub : null;
      }
      if (parent == null || parent instanceof Y.Doc || typeof (parent as Y.ID).client === 'number') {
        return null;
      }
      // parent is a Y.Type (note map, text, ...) — step up through its own item.
      const up: Y.Item | null = (parent as Y.AbstractType<unknown>)._item;
      if (up == null) return null;
      cur = up;
    }
    return null;
  };

  const consider = (item: Y.Item | GCLike, isInsertion: boolean): void => {
    if (!(item instanceof Y.Item)) return;
    const id = objectIdOf(item);
    if (id == null) return;
    touched.add(id);
    // An objects-map ENTRY in the step's insertions/deletions means the step
    // itself created/deleted that board object.
    if (item.parent === objects && typeof item.parentSub === 'string') {
      (isInsertion ? created : deleted).add(id);
    }
  };

  for (const [ds, isInsertion] of [
    [stackItem.insertions, true],
    [stackItem.deletions, false],
  ] as const) {
    ds.clients.forEach((entries, client) => {
      for (const entry of entries) {
        // A DeleteSet entry covers the clock range [clock, clock + len).
        for (let clock = entry.clock; clock < entry.clock + entry.len; clock++) {
          consider(Y.getItem(doc.store, new Y.ID(client, clock)), isInsertion);
        }
      }
    });
  }
  return { touched, created, deleted };
}

type GCLike = Y.GC | Y.Item;

/**
 * One object's full state for the post-check: generic across registered
 * types (story 9 added text objects) — geometry, stacking, the sticky
 * colour, and the Y.Text content (sticky notes AND text objects carry a
 * `text` child; typing must count as a content change, TC-25).
 */
interface ObjectState {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width: number | undefined;
  height: number | undefined;
  text: string | undefined;
  color: string | undefined;
}

function objectStates(doc: Y.Doc): Map<string, ObjectState> {
  const out = new Map<string, ObjectState>();
  doc.getMap('objects').forEach((obj, key) => {
    if (!(obj instanceof Y.Map) || typeof key !== 'string') return;
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const width = obj.get('width');
    const height = obj.get('height');
    const text = obj.get('text');
    const color = obj.get('color');
    out.set(key, {
      id: key,
      type: typeof obj.get('type') === 'string' ? obj.get('type') : '',
      x,
      y,
      z: typeof obj.get('z') === 'number' ? obj.get('z') : 0,
      width: typeof width === 'number' ? width : undefined,
      height: typeof height === 'number' ? height : undefined,
      text: text instanceof Y.Text ? text.toString() : undefined,
      color: typeof color === 'string' ? color : undefined,
    });
  });
  return out;
}

function sameState(a: ObjectState, b: ObjectState): boolean {
  return (
    a.type === b.type &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.width === b.width &&
    a.height === b.height &&
    a.text === b.text &&
    a.color === b.color
  );
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of listeners) cb();
  };
  const onItemAdded = (event: { type: 'undo' | 'redo' }): void => {
    // Trim the OLDEST step when the undo stack exceeds maxSteps (undo.limit).
    // Only the last element is ever popped, so dropping from the front is safe.
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) {
        manager.undoStack.shift();
      }
    }
    notify();
  };
  // 'stack-cleared' is how a new local step clears the REDO stack
  // (UndoManager default, undo.redo_cleared) — it is not covered by
  // added/popped.
  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  /**
   * Discard the top step of `dir` without applying it (undo.safe): the step
   * targets a structure that was deleted by someone else, so its inverse
   * cannot be applied. Mirrors yjs' pop bookkeeping, except the step is
   * discarded entirely (not pushed onto the opposite stack — it can never be
   * applied against this doc state again).
   */
  const discardTop = (dir: 'undo' | 'redo'): void => {
    const stack = dir === 'undo' ? manager.undoStack : manager.redoStack;
    const stackItem = stack[stack.length - 1];
    stack.splice(stack.length - 1, 1);
    manager.lastChange = 0; // next local change starts a fresh step
    // Same 'stack-item-popped' event yjs emits on a normal pop, so listeners
    // (UI updates) stay consistent.
    manager.emit('stack-item-popped', [
      {
        stackItem,
        origin: manager,
        type: dir,
        changedParentTypes: new Map(),
      },
    ] as never);
  };

  /**
   * Apply the top step of `dir` with the undo.safe guard.
   *
   * Pre-check: if the step touches a board object that no longer exists and
   * this very step did not delete it, the inverse would target a REMOTELY
   * deleted structure — Yjs' pop loop would then cascade into older steps
   * and apply them, corrupting unrelated content (unit TC-07) — so the step
   * is discarded as a no-op.
   *
   * Post-check (safety net): the board state around the call is compared;
   * anything the step did not itself create/delete/touch must be untouched.
   *
   * @returns true when the board state changed, false for a no-op.
   */
  const applyGuarded = (dir: 'undo' | 'redo'): boolean => {
    const stack = dir === 'undo' ? manager.undoStack : manager.redoStack;
    if (stack.length === 0) return false;
    const stackItem = stack[stack.length - 1];
    const { touched, created, deleted } = stepObjectIds(doc, stackItem);

    const before = objectStates(doc);
    const missing = [...touched].filter((id) => !before.has(id));
    if (missing.some((id) => !deleted.has(id))) {
      // The step targets a structure someone else deleted — no-op (discard).
      discardTop(dir);
      return false;
    }

    if (dir === 'undo') manager.undo();
    else manager.redo();
    const after = objectStates(doc);
    const beforeIds = new Set(before.keys());

    let damaged = false;
    for (const [id, b] of before) {
      const a = after.get(id);
      if (a == null) {
        // Gone. Legitimate only when THIS step created it (undo of a create).
        if (!created.has(id)) damaged = true;
      } else if (!sameState(b, a)) {
        // Modified. Legitimate only for objects the step touched.
        if (!touched.has(id)) damaged = true;
      }
    }
    for (const id of after.keys()) {
      if (!beforeIds.has(id)) {
        // Appeared. Legitimate only when THIS step deleted it (undo of a
        // delete — restored with its content as of the delete).
        if (!deleted.has(id)) damaged = true;
      }
    }

    if (damaged) {
      // Safety net (the pre-check makes this unreachable in practice): the
      // inverse damaged unrelated content — discard the step and report a
      // no-op. (A binary rollback cannot resurrect deleted items, so the
      // pre-check is the real protection.)
      discardTop(dir);
      return false;
    }
    if (before.size !== after.size) return true;
    for (const [id, b] of before) {
      if (!sameState(b, after.get(id)!)) return true;
    }
    return false;
  };

  return {
    undo: () => applyGuarded('undo'),
    redo: () => applyGuarded('redo'),
    boundary: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope: (type) => manager.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    stackLength: () => manager.undoStack.length,
    destroy: () => {
      manager.off('stack-item-added', onItemAdded);
      manager.off('stack-item-popped', notify);
      manager.off('stack-cleared', notify);
      manager.destroy();
      listeners.clear();
    },
  };
}
