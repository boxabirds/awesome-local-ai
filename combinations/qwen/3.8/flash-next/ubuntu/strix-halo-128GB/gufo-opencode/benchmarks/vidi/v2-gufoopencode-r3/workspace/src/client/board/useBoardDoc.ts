import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  snapshotAll,
  type ObjectSnapshot,
  type StickySnapshot
} from '../../shared/board-model';
import { connectBoard, type BoardConnection } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  // Sticky notes only (story 2 UI surfaces: toolbar colour, test hooks).
  notes: readonly StickySnapshot[];
  // Every valid object of every registered type, for rendering and grouping.
  objects: readonly ObjectSnapshot[];
  // Live connection to the board room, or null while unconnected (tests that
  // inject a doc, or before a board id is known).
  connection: BoardConnection | null;
}

const EMPTY_NOTES: readonly StickySnapshot[] = [];
const EMPTY_OBJECTS: readonly ObjectSnapshot[] = [];

interface Cache {
  revision: number;
  notes: readonly StickySnapshot[];
  objects: readonly ObjectSnapshot[];
}

// Owns the single local Y.Doc for this page. With a boardId, attaches the
// y-websocket provider to the same doc and destroys it on unmount or when
// the board changes (story 4 persists it). The snapshots are recomputed only
// when the objects map changes (observeDeep) and shared via
// useSyncExternalStore. An existing doc can be supplied (tests).
export function useBoardDoc(provided?: Y.Doc, boardId?: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(provided ?? null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cacheRef = useRef<Cache | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = { revision: 0, notes: snapshot(doc), objects: snapshotAll(doc) };
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        const prev = cacheRef.current;
        cacheRef.current = {
          revision: (prev?.revision ?? 0) + 1,
          notes: snapshot(doc),
          objects: snapshotAll(doc)
        };
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc]
  );

  const notes = useSyncExternalStore(
    subscribe,
    () => cacheRef.current?.notes ?? EMPTY_NOTES,
    () => cacheRef.current?.notes ?? EMPTY_NOTES
  );
  const objects = useSyncExternalStore(
    subscribe,
    () => cacheRef.current?.objects ?? EMPTY_OBJECTS,
    () => cacheRef.current?.objects ?? EMPTY_OBJECTS
  );

  const [connection, setConnection] = useState<BoardConnection | null>(null);
  useEffect(() => {
    if (boardId === undefined) return;
    const next = connectBoard(doc, boardId);
    setConnection(next);
    return () => {
      setConnection(null);
      next.destroy();
    };
  }, [doc, boardId]);

  return useMemo(() => ({ doc, notes, objects, connection }), [doc, notes, objects, connection]);
}
