import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshotAll, getObjectsMap } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  /** Immutable objects sorted by (z, id). Recomputed on any document change. */
  notes: readonly ObjectSnapshot[];
  /** Connection state for the live sync provider. */
  connectionState: ConnectionState;
}

/**
 * Owns the single `Y.Doc` of this board and exposes an immutable snapshot to
 * React via `useSyncExternalStore`. Attaches a WebsocketProvider for live
 * collaboration. Selection and editing are local state and never written here.
 *
 * When `boardId` is null/empty, no provider is attached (used in component tests).
 */
export function useBoardDoc(boardId: string | null): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );

  // Attach/detach provider on boardId change
  useEffect(() => {
    if (!boardId) return;
    const handle = connectBoard(doc, boardId, setConnectionState);
    return () => handle.destroy();
  }, [doc, boardId]);

  const revisionRef = useRef(0);
  const cacheRef = useRef<{ rev: number; value: readonly ObjectSnapshot[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = getObjectsMap(doc);
      const observer = () => {
        revisionRef.current += 1;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => {
        objects.unobserveDeep(observer);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly ObjectSnapshot[] => {
    if (!cacheRef.current || cacheRef.current.rev !== revisionRef.current) {
      cacheRef.current = { rev: revisionRef.current, value: snapshotAll(doc) };
    }
    return cacheRef.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connectionState };
}
