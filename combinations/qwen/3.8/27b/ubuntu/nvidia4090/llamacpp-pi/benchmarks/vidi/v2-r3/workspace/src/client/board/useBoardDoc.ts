import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the board's Y.Doc and exposes an immutable snapshot of its contents.
 * Re-renders on every document update (local or remote). When a boardId is
 * given, attaches the y-websocket provider for the live room and destroys it
 * on unmount or board change.
 */
export function useBoardDoc(boardId: string | null): {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [notes, setNotes] = useState<readonly StickySnapshot[]>(() => snapshot(doc));
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const handler = () => {
      setNotes(snapshot(doc));
    };
    doc.on('update', handler);
    return () => {
      doc.off('update', handler);
    };
  }, [doc]);

  useEffect(() => {
    if (boardId === null) return;
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => {
      conn.destroy();
    };
  }, [doc, boardId]);

  return { doc, notes, connectionState };
}
