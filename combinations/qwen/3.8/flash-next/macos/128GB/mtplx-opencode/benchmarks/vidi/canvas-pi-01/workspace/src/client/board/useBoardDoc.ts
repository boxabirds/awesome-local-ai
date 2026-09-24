/**
 * Story 2 · task 2 — the `useBoardDoc` hook (design "Board document model").
 *
 * Owns one `Y.Doc`, keeps an immutable `StickySnapshot[]` in sync with it and
 * hands that to React through `useSyncExternalStore`. The Y.Doc is the single
 * source of truth: in story 3 a network provider is attached to it, in story 4
 * the same document is persisted. Nothing here knows about the network.
 */
import { useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

interface SnapshotStore {
  doc: Y.Doc;
  getSnapshot(): readonly StickySnapshot[];
  subscribe(onStoreChange: () => void): () => void;
}

/**
 * Keep a memoised snapshot aligned with the document. `observeDeep` fires for
 * any change to `objects` or any nested Y.Map / Y.Text, so a text edit, a
 * move, a recolour or an add/delete all recompute the snapshot. The array
 * identity only changes on a real change, so React never re-renders in a loop.
 */
function createStore(doc: Y.Doc): SnapshotStore {
  let current = snapshot(doc);
  const listeners = new Set<() => void>();
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const notify = () => {
    current = snapshot(doc);
    for (const listener of listeners) listener();
  };
  objects.observeDeep(notify);
  return {
    doc,
    getSnapshot: () => current,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
  };
}

export interface BoardDoc {
  doc: Y.Doc;
  /** Notes sorted by (z, id); the render order. */
  notes: readonly StickySnapshot[];
}

/**
 * Create (or adopt) the board document and subscribe to it. When `external`
 * is supplied (component tests) it is used as-is; otherwise a fresh, empty
 * document is created for this board.
 */
export function useBoardDoc(external?: Y.Doc): BoardDoc {
  const ref = useRef<{ doc: Y.Doc; store: SnapshotStore } | null>(null);
  if (ref.current === null || (external !== undefined && ref.current.doc !== external)) {
    const doc = external ?? new Y.Doc();
    if (external === undefined) initDoc(doc);
    ref.current = { doc, store: createStore(doc) };
  }
  const { doc, store } = ref.current;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc, notes };
}