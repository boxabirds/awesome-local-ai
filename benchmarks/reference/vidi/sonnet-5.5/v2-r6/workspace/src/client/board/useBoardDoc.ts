import { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc { doc: Y.Doc; notes: readonly StickySnapshot[] }

interface Store {
  doc: Y.Doc;
  subscribe(cb: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

function createStore(): Store {
  const doc = new Y.Doc();
  initDoc(doc);
  let current = snapshot(doc);
  const objects = doc.getMap('objects');
  return {
    doc,
    subscribe(cb) {
      const handler = () => {
        current = snapshot(doc);
        cb();
      };
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    },
    getSnapshot: () => current,
  };
}

/** Owns the board's Y.Doc and exposes an immutable, memoised snapshot of it. */
export function useBoardDoc(): BoardDoc {
  const store = useMemo(createStore, []);
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { doc: store.doc, notes };
}
