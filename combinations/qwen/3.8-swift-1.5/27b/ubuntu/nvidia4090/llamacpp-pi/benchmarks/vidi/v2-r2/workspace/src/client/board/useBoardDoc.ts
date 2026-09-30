import { useCallback, useEffect, useRef, useSyncExternalStore, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

interface BoardState {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  boardId: string | undefined;
}

/**
 * Owns the in-memory Y.Doc and exposes an immutable snapshot of the board via
 * useSyncExternalStore. When a boardId is provided, attaches a y-websocket
 * provider for live collaboration. Destroys the provider on unmount/board change.
 */
export function useBoardDoc(boardId?: string): BoardDoc {
  const stateRef = useRef<BoardState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(boardId ? 'connecting' : 'connected');

  // Create the doc once (or when boardId changes)
  if (stateRef.current === null || stateRef.current.boardId !== boardId) {
    // Destroy old doc if board changed
    if (stateRef.current) {
      stateRef.current.doc.destroy();
    }
    const doc = new Y.Doc();
    initDoc(doc);
    stateRef.current = { doc, notes: snapshot(doc), boardId };
  }
  const { doc } = stateRef.current;

  // Attach provider when boardId is available
  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => {
      conn.destroy();
    };
  }, [doc, boardId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      doc.destroy();
      if (stateRef.current?.doc === doc) {
        stateRef.current = null;
      }
    };
  }, [doc]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        if (stateRef.current?.doc !== doc) return;
        stateRef.current.notes = snapshot(doc);
        onChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc]
  );

  const getSnapshot = useCallback(() => stateRef.current?.notes ?? EMPTY_NOTES, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes, connectionState };
}

const EMPTY_NOTES: readonly StickySnapshot[] = [];
