// undo (story 8, undo.history): per-client undo/redo of this tab's own
// changes only.
//
// The building block is a Y.UndoManager scoped to the board's `objects`
// map, tracking only this tab's LOCAL_ORIGIN, so remote (provider) changes
// and story 4 load updates never enter the stack (undo.own). New local
// steps clear the redo stack (UndoManager default, undo.redo_cleared), and
// a fresh controller after reload starts empty (undo.session_only).
//
// On top of the native manager we layer one product-level correction: yjs
// pops past no-op stack items inside a single undo()/redo() call — when a
// step's inverse performs no visible change (e.g. the peer deleted the
// object the step touched), yjs still consumes the item and immediately
// pops the next one, which would undo an unrelated step in the same press
// (and could remove someone else's object). To keep "one press = one
// meaningful step" (undo.safe), undo()/redo() peek at the top item: when
// its inverse would perform no change on the current document we pop it
// manually (no doc transaction, no cascade), and otherwise let the native
// manager pop exactly one item.
//
// Whether an item's inverse performs a change is decided from structural
// meta recorded on stack-item-added/-updated: which object ids the item's
// structs touch, and which top-level objects the item deletes. The meta
// stays valid even after the structs are garbage-collected.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo one of my steps. Returns false on an empty undo stack. */
  undo(): boolean;
  /** Redo one of my steps. Returns false on an empty redo stack. */
  redo(): boolean;
  /** Whether undo() would consume a step. */
  canUndo(): boolean;
  /** Whether redo() would consume a step. */
  canRedo(): boolean;
  /** End the current capture interval so the next change starts a new step. */
  boundary(): void;
  /** Extend the capture scope (story 16 will add non-object types). */
  addScope(type: Y.AbstractType<any>): void;
  /** Subscribe to stack changes (items added/popped/trimmed/cleared). */
  onChange(cb: () => void): () => void;
  /** Dispose; a fresh controller afterwards starts with empty stacks. */
  destroy(): void;
}

export interface CreateUndoOptions {
  /** Merge changes made within this gap into one step (undo.boundaries). */
  captureTimeoutMs?: number;
  /** Keep at most this many undo steps (undo.limit). */
  maxSteps?: number;
}

/** Meta key on StackItem.meta carrying our structural per-item summary. */
const META_KEY = 'vidi6.undo';

interface ItemMeta {
  /** Object ids any of the item's structs belongs to. */
  touched: Set<string>;
  /** Top-level object ids the item deletes (its inverse restores them). */
  removed: Set<string>;
  /** True when a struct could not be resolved (GC'd, or outside the
   * objects scope): we cannot prove a no-op, so treat the step as live. */
  unknown: boolean;
}

/** The (internal) DeleteSet type, taken from a public signature. */
type DeleteSet = Parameters<typeof Y.isDeleted>[0];
/** The board's objects map: id → object map. */
type ObjectsMap = Y.Map<Y.Map<unknown>>;

type StackItemLike = {
  meta: Map<string, unknown>;
  insertions: DeleteSet;
  deletions: DeleteSet;
};
type DeletionsHolder = { deletions: DeleteSet };

/**
 * Read-only walk over the structs a DeleteSet covers. Yjs's own
 * iterateDeletedStructs may split items to align the ranges, which mutates
 * the document and requires a live transaction's _mergeStructs buffer; this
 * controller inspects structs outside a transaction, so it walks the raw
 * per-client struct arrays instead and yields every struct overlapping a
 * deleted range (a struct larger than the range is yielded whole).
 */
function walkDeleted(doc: Y.Doc, ds: DeleteSet, f: (struct: Y.AbstractStruct) => void): void {
  const clients = (
    doc.store as unknown as { clients: Map<number, Array<Y.AbstractStruct>> }
  ).clients;
  ds.clients.forEach((deletes, clientid) => {
    const structs = clients.get(clientid);
    if (structs === undefined || structs.length === 0) return;
    const clockState =
      structs[structs.length - 1].id.clock + structs[structs.length - 1].length;
    for (const del of deletes) {
      if (del.clock >= clockState) continue; // range beyond the store (GC'd)
      const clockEnd = del.clock + del.len;
      let i = 0;
      while (i < structs.length && structs[i].id.clock + structs[i].length <= del.clock) {
        i += 1;
      }
      while (i < structs.length && structs[i].id.clock < clockEnd) {
        f(structs[i]);
        i += 1;
      }
    }
  });
}

/**
 * Resolve the id of the board object a struct belongs to by walking the
 * parent chain up to the `objects` map:
 *  - an object entry item (parent === objects): its parentSub is the id
 *  - a field item (parent = the object's Y.Map): one hop up
 *  - a text-content item (parent = a Y.Text): two hops up
 * Returns null when the chain is broken (GC'd parent) or the struct is not
 * under the objects map.
 */
function objectIdOf(struct: Y.Item, objects: ObjectsMap): string | null {
  if (struct.parent === objects) {
    return struct.parentSub === null ? null : String(struct.parentSub);
  }
  // `parent` is the owning type (Y.Map or Y.Text); its `_item` is the CRDT
  // item that stores it in its own parent. The chain is at most 3 deep
  // (field → object map → objects), so the guard is generous.
  let type: Y.AbstractType<any> | Y.ID | null = struct.parent;
  for (let guard = 0; type !== null; guard += 1) {
    if (guard > 64) return null; // defensive
    if (!(type instanceof Y.AbstractType)) return null; // an ID, not a type
    const item = type._item;
    if (item === null) return null; // reached a root type: not under objects
    if (!(item instanceof Y.Item)) return null; // parent entry was GC'd
    if (item.parent === objects) {
      return item.parentSub === null ? null : String(item.parentSub);
    }
    type = item.parent;
  }
  return null;
}

/** Record (or refresh) the structural meta of a stack item. */
function recordMeta(doc: Y.Doc, objects: ObjectsMap, stackItem: StackItemLike): void {
  const meta: ItemMeta = { touched: new Set(), removed: new Set(), unknown: false };
  const scan = (ds: DeleteSet, isDeletion: boolean): void => {
    walkDeleted(doc, ds, (struct: Y.AbstractStruct) => {
      if (!(struct instanceof Y.Item)) {
        meta.unknown = true; // GC'd: we can no longer see what it touched
        return;
      }
      const id = objectIdOf(struct, objects);
      if (id === null) {
        meta.unknown = true; // outside the objects scope (or GC'd chain)
        return;
      }
      meta.touched.add(id);
      if (isDeletion && struct.parent === objects) meta.removed.add(id);
    });
  };
  scan(stackItem.insertions, false);
  scan(stackItem.deletions, true);
  stackItem.meta.set(META_KEY, meta);
}

/**
 * The items yjs would try to restore for this stack item (its deletions,
 * minus structs created and deleted within the same item).
 */
function itemsToRedo(doc: Y.Doc, item: StackItemLike): Set<Y.Item> {
  const out = new Set<Y.Item>();
  walkDeleted(doc, item.deletions, (struct: Y.AbstractStruct) => {
    if (!(struct instanceof Y.Item)) return;
    if (Y.isDeleted(item.insertions, struct.id)) return;
    out.add(struct);
  });
  return out;
}

/** Follow the redone chain of an item without a transaction (raw store walk). */
function followRedone(store: Y.Doc['store'], id: Y.ID): Y.Item | undefined {
  let cur = Y.getItem(store, id);
  for (let guard = 0; cur !== undefined && cur.redone !== null; guard += 1) {
    if (guard > 64) return undefined;
    cur = Y.getItem(store, cur.redone);
  }
  return cur;
}

/**
 * Would yjs's redoItem() succeed for this item (mirror of yjs's redoItem
 * rejection paths for our data model)?
 */
function restorable(
  s: Y.Item,
  store: Y.Doc['store'],
  item: StackItemLike,
  toRedo: Set<Y.Item>,
  undoStack: readonly DeletionsHolder[],
  redoStack: readonly DeletionsHolder[],
  objects: ObjectsMap,
): boolean {
  if (s.redone !== null) return true; // yjs returns the redone item
  const parentItem = (s.parent as unknown as { _item: Y.Item | Y.GC | null })._item;
  if (parentItem !== null && parentItem instanceof Y.Item && parentItem.deleted) {
    // yjs only proceeds when the parent is restored in the same step.
    if (parentItem.redone === null && !toRedo.has(parentItem)) return false;
  }
  if (s.parentSub === null) return true; // text/array item: yjs always inserts
  if (s.parent === objects) return true; // top-level entry: no same-key conflict
  // Map-value right-chain conflict: yjs walks right while the neighbour is
  // redone / in this item's insertions / deleted by any stack item; a stop
  // at a live neighbour means the restore conflicts and is refused.
  const inStackDeletions = (id: Y.ID): boolean =>
    undoStack.some((st) => Y.isDeleted(st.deletions, id)) ||
    redoStack.some((st) => Y.isDeleted(st.deletions, id));
  let left: Y.Item | null = s;
  for (let guard = 0; left !== null; guard += 1) {
    if (guard > 4096) return false; // defensive: no unbounded walk
    const right: Y.Item | null = left.right;
    if (right === null) return true;
    const skip =
      right.redone !== null ||
      Y.isDeleted(item.insertions, right.id) ||
      inStackDeletions(right.id);
    if (!skip) return false;
    left = right.redone !== null ? (followRedone(store, right.redone) ?? null) : right;
  }
  return false;
}

/**
 * Does the inverse of this stack item perform any visible change on the
 * current document? Mirrors yjs's popStackItem performedChange decision.
 */
function hasEffect(
  doc: Y.Doc,
  objects: ObjectsMap,
  item: StackItemLike,
  undoStack: readonly DeletionsHolder[],
  redoStack: readonly DeletionsHolder[],
): boolean {
  const meta = item.meta.get(META_KEY) as ItemMeta | undefined;
  if (!meta) return true; // defensive: never prove a no-op from nothing
  if (meta.unknown) return true;
  if (meta.removed.size > 0) return true; // inverse restores deleted objects: always a change
  if (meta.touched.size === 0) return true; // defensive
  const toRedo = itemsToRedo(doc, item);
  for (const id of meta.touched) {
    if (objects.get(id) === undefined) continue; // peer deleted it: inverse touches nothing
    if (liveEffect(doc, objects, item, id, toRedo, undoStack, redoStack)) return true;
  }
  return false;
}

/** For a present object: would the inverse change anything of it? */
function liveEffect(
  doc: Y.Doc,
  objects: ObjectsMap,
  item: StackItemLike,
  id: string,
  toRedo: Set<Y.Item>,
  undoStack: readonly DeletionsHolder[],
  redoStack: readonly DeletionsHolder[],
): boolean {
  const store = doc.store;
  // (a) The inverse deletes the structs I inserted: a change while any is
  // still current (not deleted, following redone as yjs does).
  let anyLive = false;
  walkDeleted(doc, item.insertions, (struct: Y.AbstractStruct) => {
    if (anyLive) return;
    if (!(struct instanceof Y.Item)) return; // GC'd: invisible to yjs too
    if (objectIdOf(struct, objects) !== id) return;
    const cur = followRedone(store, struct.id);
    if (cur !== undefined && !cur.deleted) anyLive = true;
  });
  if (anyLive) return true;
  // (b) The inverse restores the structs I deleted: a change while any is
  // restorable (yjs would produce a redone item for it).
  let anyRestorable = false;
  walkDeleted(doc, item.deletions, (struct: Y.AbstractStruct) => {
    if (anyRestorable) return;
    if (!(struct instanceof Y.Item)) return;
    if (objectIdOf(struct, objects) !== id) return;
    if (Y.isDeleted(item.insertions, struct.id)) return;
    if (restorable(struct, store, item, toRedo, undoStack, redoStack, objects)) anyRestorable = true;
  });
  return anyRestorable;
}

export function createUndo(doc: Y.Doc, opts: CreateUndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const manager = new Y.UndoManager(objects, {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };

  const onItemAdded = (arg: unknown): void => {
    const event = arg as { stackItem: StackItemLike };
    recordMeta(doc, objects, event.stackItem);
    // undo.limit: this yjs build has no undoDepth, so trim manually. Only a
    // new local step grows the undo stack; an item pushed while undoing
    // lands on the redo stack and must not shrink the undo history.
    if (!manager.undoing) {
      while (manager.undoStack.length > maxSteps) {
        manager.undoStack.shift();
      }
    }
    notify();
  };
  const onItemUpdated = (arg: unknown): void => {
    // The item merged with a newer change: refresh its meta.
    const event = arg as { stackItem: StackItemLike };
    recordMeta(doc, objects, event.stackItem);
    notify();
  };
  const onPopped = (): void => notify();
  const onCleared = (): void => notify();

  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-updated', onItemUpdated);
  manager.on('stack-item-popped', onPopped);
  manager.on('stack-cleared', onCleared);

  /**
   * Pop the top item of the given direction's stack without touching the
   * document (its inverse is a proven no-op). The step is discarded, not
   * moved to the other stack: it has nothing to re-apply, and moving the
   * un-inverted item would confuse the stack-deletion bookkeeping. The
   * press still advances the history (undo.safe: the next undo continues
   * normally).
   */
  const popNoEffect = (direction: 'undo' | 'redo'): void => {
    const stack = direction === 'undo' ? manager.undoStack : manager.redoStack;
    stack.pop();
    manager.stopCapturing();
    notify();
  };

  const run = (direction: 'undo' | 'redo'): boolean => {
    const stack = direction === 'undo' ? manager.undoStack : manager.redoStack;
    if (stack.length === 0) return false;
    for (let guard = 0; guard < 4096; guard += 1) {
      const top = stack[stack.length - 1];
      if (hasEffect(doc, objects, top, manager.undoStack, manager.redoStack)) {
        if (direction === 'undo') manager.undo();
        else manager.redo();
        return true;
      }
      popNoEffect(direction);
      if (stack.length === 0) return true; // consumed dead steps only
    }
    return stack.length === 0; // defensive: should be unreachable
  };

  return {
    undo: () => run('undo'),
    redo: () => run('redo'),
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    boundary: () => manager.stopCapturing(),
    addScope: (type) => manager.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      manager.off('stack-item-added', onItemAdded);
      manager.off('stack-item-updated', onItemUpdated);
      manager.off('stack-item-popped', onPopped);
      manager.off('stack-cleared', onCleared);
      manager.destroy();
      listeners.clear();
    },
  };
}
