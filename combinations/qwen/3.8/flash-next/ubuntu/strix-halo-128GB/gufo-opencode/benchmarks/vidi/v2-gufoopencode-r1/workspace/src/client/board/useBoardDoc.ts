import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { IS_TEST_MODE } from '../canvas/testHooks';

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
  connection: ConnectionState;
}

export function useBoardDoc(boardId?: string): BoardDoc {
  const docRef = useRef<{ boardId: string | undefined; doc: Y.Doc } | null>(null);
  if (docRef.current === null || docRef.current.boardId !== boardId) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = { boardId, doc };
  }
  const doc = docRef.current.doc;
  const [connection, setConnection] = useState<ConnectionState>(boardId ? 'connecting' : 'connected');

  useEffect(() => {
    if (boardId === undefined) return;
    const handle = connectBoard(doc, boardId, setConnection);
    if (IS_TEST_MODE && window.__vidi6 !== undefined) {
      window.__vidi6.simulateOutage = (ms: number): void => handle.simulateOutage?.(ms);
    }
    return () => handle.destroy();
  }, [doc, boardId]);

  useEffect(() => {
    if (IS_TEST_MODE && window.__vidi6 !== undefined) window.__vidi6.connectionState = connection;
  }, [connection]);

  const store = useMemo(() => createSnapshotStore(doc), [doc]);
  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connection };
}
