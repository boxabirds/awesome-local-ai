/**
 * Owns the board's single `Y.Doc`, exposes an immutable snapshot of its sticky notes to
 * React, and — when a board id is present (a `/b/:id` route) — attaches the live
 * connection and mirrors its status.
 *
 * The document is created once per `boardId` and prepared with `initDoc`. Snapshot
 * invalidation listens to `objects.observeDeep`, so it fires for note add/remove, a
 * moved/repainted field, and text edits inside a note's `Y.Text` — but not for `meta`.
 * The create flow (`/`) passes no board id, so it has no connection and
 * `connectionStatus` is null; the badge is then not rendered.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model.js';
import { connectBoard, type ConnectionStatus } from './connectBoard.js';

export interface UseBoardDocOptions {
  /** When set (a `/b/:id` route), the doc is connected live to that board's room. */
  boardId?: string;
}

export interface BoardDoc {
  /** The live Yjs document every mutation and the provider attach to. */
  readonly doc: Y.Doc;
  /** An immutable snapshot of every sticky note, recomputed when the doc changes. */
  readonly notes: readonly StickySnapshot[];
  /** Live connection status, or null when there is no connection (the create flow). */
  readonly connectionStatus: ConnectionStatus | null;
  /** Other present editors (self excluded), or null when there is no connection. */
  readonly peerCount: number | null;
}

export function useBoardDoc(options?: UseBoardDocOptions): BoardDoc {
  const boardId = options?.boardId;

  // One document per board id; StrictMode's double-invoke must not create two docs.
  const docRef = useRef<{ boardId: string | undefined; doc: Y.Doc } | null>(null);
  if (docRef.current === null || docRef.current.boardId !== boardId) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = { boardId, doc };
  }
  const doc = docRef.current.doc;

  // The snapshot cache: `getSnapshot` must return a stable reference unless data changed.
  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));
  const listenersRef = useRef<Set<() => void>>(new Set());

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const listeners = listenersRef.current;
      listeners.add(onStoreChange);
      const objects = doc.getMap('objects');
      const observer = (): void => {
        cacheRef.current = snapshot(doc);
        for (const listener of listeners) listener();
      };
      objects.observeDeep(observer);
      return () => {
        listeners.delete(onStoreChange);
        objects.unobserveDeep(observer);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => cacheRef.current, []);
  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Live connection: only a board route connects. `connectBoard` reports 'connecting'
  // synchronously, so the badge never shows an offline first frame.
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [peerCount, setPeerCount] = useState<number | null>(null);
  useEffect(() => {
    if (boardId === undefined) {
      setConnectionStatus(null);
      setPeerCount(null);
      return;
    }
    cacheRef.current = snapshot(doc);
    const connection = connectBoard({
      doc,
      boardId,
      onStatus: setConnectionStatus,
      onPeers: setPeerCount,
    });
    return () => {
      connection.destroy();
    };
  }, [doc, boardId]);

  return useMemo<BoardDoc>(
    () => ({ doc, notes, connectionStatus, peerCount }),
    [doc, notes, connectionStatus, peerCount],
  );
}
