import { useSyncExternalStore, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Owns one `Y.Doc` and exposes an immutable snapshot of its sticky objects to
 * React through `useSyncExternalStore`. Story 3 attaches a network provider to
 * `doc`; story 4 persists the same document.
 */
export interface BoardStore {
  readonly doc: Y.Doc;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

export function createBoardStore(): BoardStore {
  const doc = new Y.Doc();
  initDoc(doc);

  let current = snapshot(doc);
  const listeners = new Set<() => void>();
  let observer: ((events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void) | null =
    null;

  const objects = doc.getMap<Y.Map<unknown>>('objects');

  return {
    doc,
    subscribe(onChange) {
      listeners.add(onChange);
      if (!observer) {
        observer = () => {
          // Recompute once per Yjs transaction; every listener then reads the
          // same cached snapshot reference.
          current = snapshot(doc);
          listeners.forEach((l) => l());
        };
        objects.observeDeep(observer);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && observer) {
          objects.unobserveDeep(observer);
          observer = null;
        }
      };
    },
    getSnapshot() {
      return current;
    },
  };
}

export interface UseBoardDocResult {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * @param existing optional store, injected by tests. When omitted the hook owns
 *   a fresh in-memory document (notes do not survive a reload until story 4).
 */
export function useBoardDoc(existing?: BoardStore): UseBoardDocResult {
  const [own] = useState(createBoardStore);
  const store = existing ?? own;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc: store.doc, notes };
}
