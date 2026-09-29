import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { type ObjectSnapshot, initDoc, objectsSnapshot, snapshot } from '../../shared/board-model';
import { installTestHooks } from '../canvas/testHooks';
import { type ConnectionState, connectBoard } from '../sync/connectBoard';

interface BoardStore {
  doc: Y.Doc;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): readonly ObjectSnapshot[];
}

function createStore(doc: Y.Doc): BoardStore {
  initDoc(doc);
  const objects = doc.getMap('objects');
  const listeners = new Set<() => void>();
  let current = objectsSnapshot(doc);
  const onChange = () => {
    current = objectsSnapshot(doc);
    for (const listener of listeners) listener();
  };
  return {
    doc,
    subscribe(listener) {
      if (listeners.size === 0) {
        objects.observeDeep(onChange);
        current = objectsSnapshot(doc);
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
 * Owns the board's Y.Doc and exposes an immutable, memoised snapshot of its objects.
 * With a `boardId` the doc is connected to that board's live room (destroyed on unmount or
 * board change); remote changes re-render through the same observer as local ones.
 * `existing` lets tests supply the doc.
 */
export function useBoardDoc(
  boardId?: string | null,
  existing?: Y.Doc,
): { doc: Y.Doc; objects: readonly ObjectSnapshot[]; connection: ConnectionState } {
  // A new board gets a new document.
  const store = useMemo(() => createStore(existing ?? new Y.Doc()), [boardId, existing]);
  const objects = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );

  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(store.doc, boardId, setConnection);
    return () => conn.destroy();
  }, [store, boardId]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({
      getNotes: () => snapshot(store.doc),
      getObjects: () => objectsSnapshot(store.doc),
    });
  }, [store]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    const hooks = (window.__vidi6 ??= {});
    hooks.connectionState = connection;
    (hooks.connectionHistory ??= []).push(connection);
  }, [connection]);

  return { doc: store.doc, objects, connection };
}
