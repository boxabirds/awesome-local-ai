import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { type StickySnapshot, initDoc, snapshot } from '../../shared/board-model';
import { installTestHooks } from '../canvas/testHooks';

interface BoardStore {
  doc: Y.Doc;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

function createStore(doc: Y.Doc): BoardStore {
  initDoc(doc);
  const objects = doc.getMap('objects');
  const listeners = new Set<() => void>();
  let current = snapshot(doc);
  const onChange = () => {
    current = snapshot(doc);
    for (const listener of listeners) listener();
  };
  return {
    doc,
    subscribe(listener) {
      if (listeners.size === 0) {
        objects.observeDeep(onChange);
        current = snapshot(doc);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) objects.unobserveDeep(onChange);
      };
    },
    getSnapshot: () => current,
  };
}

/**
 * Owns the board's Y.Doc (in memory in this story; story 3 attaches a provider, story 4
 * persists it) and exposes an immutable, memoised snapshot of its sticky notes.
 */
export function useBoardDoc(existing?: Y.Doc): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const [store] = useState(() => createStore(existing ?? new Y.Doc()));
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({ getNotes: () => snapshot(store.doc) });
  }, [store]);

  return { doc: store.doc, notes };
}
