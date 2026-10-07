// useBoardDoc (story 2 + 3): owns the Y.Doc, attaches a network provider when
// boardId is provided, and exposes an immutable snapshot of all sticky notes
// via useSyncExternalStore.

import * as Y from 'yjs';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

interface BoardStore {
  readonly doc: Y.Doc;
  listeners: Set<() => void>;
  current: readonly StickySnapshot[];
  dirty: boolean;
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly objects: readonly StickySnapshot[];
  readonly connectionState: ConnectionState;
}

export function useBoardDoc(boardId?: string): BoardDoc {
  const ref = useRef<BoardStore | null>(null);
  if (ref.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    ref.current = {
      doc,
      listeners: new Set(),
      current: snapshot(doc),
      dirty: false,
    };
  }
  const store = ref.current;

  // Connection state: use a ref + useSyncExternalStore for stable identity
  const connStateRef = useRef<ConnectionState>('connecting');
  const connListeners = useRef<Set<() => void>>(new Set());

  const subscribeConn = useCallback((cb: () => void) => {
    connListeners.current.add(cb);
    return () => { connListeners.current.delete(cb); };
  }, []);
  const getConnSnapshot = useCallback(() => connStateRef.current, []);

  // Attach network provider when boardId is available
  const boardIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!boardId) return;
    if (boardIdRef.current === boardId) return;

    boardIdRef.current = boardId;
    const conn = connectBoard(store.doc, boardId, (s) => {
      if (connStateRef.current === s) return;
      connStateRef.current = s;
      connListeners.current.forEach((l) => l());
    });
    return () => {
      conn.destroy();
    };
  }, [boardId, store.doc]);

  // observeDeep for document changes
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    const objects = s.doc.getMap('objects');
    const markDirty = () => {
      s.dirty = true;
      s.listeners.forEach((l) => l());
    };
    markDirty();
    objects.observeDeep(markDirty);
    return () => {
      objects.unobserveDeep(markDirty);
    };
  }, []);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      store.listeners.add(onStoreChange);
      return () => {
        store.listeners.delete(onStoreChange);
      };
    },
    [store],
  );
  const getSnapshot = useCallback(() => {
    if (store.dirty) {
      store.current = snapshot(store.doc);
      store.dirty = false;
    }
    return store.current;
  }, [store]);

  const objects = useSyncExternalStore(subscribe, getSnapshot);
  const connectionState = useSyncExternalStore(subscribeConn, getConnSnapshot);

  return { doc: store.doc, objects, connectionState };
}
