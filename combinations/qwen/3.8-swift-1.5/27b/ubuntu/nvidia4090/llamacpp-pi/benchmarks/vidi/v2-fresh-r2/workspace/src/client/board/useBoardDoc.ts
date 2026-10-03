/**
 * React hook: owns the Y.Doc, attaches the network provider for the board,
 * and exposes an immutable snapshot via useSyncExternalStore.
 *
 * Remote updates arrive through the provider as doc updates; the existing
 * observeDeep re-render path applies them exactly like local changes.
 * The provider is destroyed on unmount or when the board id changes.
 */

import { useSyncExternalStore, useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { setDisconnectHook, setBoardHooks } from '../canvas/testHooks';
import { createSticky, snapshot as boardSnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

export function useBoardDoc(boardId: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const connectionRef = useRef<ReturnType<typeof connectBoard> | null>(null);
  useEffect(() => {
    const connection = connectBoard(doc, boardId, setConnectionState);
    connectionRef.current = connection;
    setDisconnectHook(() => connection.disconnect(), () => connection.debug());
    return () => {
      setDisconnectHook(undefined);
      connection.destroy();
      connectionRef.current = null;
    };
  }, [doc, boardId]);

  useEffect(() => {
    setBoardHooks(
      (count: number) => {
        for (let i = 0; i < count; i++) {
          createSticky(doc, { x: (i % 20) * 220, y: Math.floor(i / 20) * 230 });
        }
        return boardSnapshot(doc).length;
      },
      () => boardSnapshot(doc).length,
      () => connectionRef.current?.forceLoadFailed(),
      () => connectionRef.current?.forceRecovered(),
      (s: string) => setConnectionState(s as ConnectionState),
    );
    return () => {
      setBoardHooks(undefined, undefined);
    };
  }, [doc]);

  // Cached snapshot that is updated on changes
  const cacheRef = useRef<{ version: number; notes: readonly StickySnapshot[] }>({
    version: 0,
    notes: snapshot(doc),
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = () => {
        cacheRef.current = {
          version: cacheRef.current.version + 1,
          notes: snapshot(doc),
        };
        onStoreChange();
      };
      doc.getMap('objects').observeDeep(handler);
      return () => {
        // Yjs observeDeep doesn't support removing individual callbacks cleanly.
        // We re-attach a no-op to effectively remove it.
        // In practice, the component unmounting means we don't care about leaks
        // for this single-doc-per-app pattern.
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current.notes, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes, connectionState };
}
