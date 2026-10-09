import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

interface SnapshotStore {
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

// Memoises the immutable snapshot and recomputes it only when the objects map
// changes. The single observeDeep observer is attached on the first subscriber
// and detached when the last unsubscribes.
function createSnapshotStore(doc: Y.Doc): SnapshotStore {
  const objects = doc.getMap('objects');
  let current: readonly StickySnapshot[] = snapshot(doc);
  const listeners = new Set<() => void>();
  let observer: ((events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void) | null = null;

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      if (observer === null) {
        observer = () => {
          current = snapshot(doc);
          for (const listener of listeners) listener();
        };
        objects.observeDeep(observer);
      }
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && observer !== null) {
          objects.unobserveDeep(observer);
          observer = null;
        }
      };
    },
    getSnapshot() {
      return current;
    }
  };
}

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

export function useBoardDoc(): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;
  const store = useMemo(() => createSnapshotStore(doc), [doc]);
  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
