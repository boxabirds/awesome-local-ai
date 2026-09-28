import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, createSticky, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { installDocHooks } from '../canvas/testHooks';

export interface BoardDocState {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

/**
 * Owns a single Y.Doc, subscribes to deep changes on `objects`,
 * and exposes an immutable snapshot via useState.
 * Also manages the WebSocket connection for live collaboration.
 */
export function useBoardDoc(boardId: string): BoardDocState {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    installDocHooks(Y, (doc, pos) => createSticky(doc, pos));
    return d;
  }, []);

  const objectsMap = useMemo(
    () => doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>,
    [doc],
  );

  const [notes, setNotes] = useState<readonly StickySnapshot[]>(() => snapshot(doc));

  useEffect(() => {
    const observer = () => {
      setNotes(snapshot(doc));
    };
    objectsMap.observeDeep(observer);
    return () => {
      objectsMap.unobserveDeep(observer);
    };
  }, [doc, objectsMap]);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
