import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

/**
 * Owns the board's Y.Doc and exposes an immutable snapshot of its contents.
 * Re-renders on every document update (local or remote). When a boardId is
 * given, attaches the y-websocket provider for the live room and destroys it
 * on unmount or board change.
 *
 * Story 7 (sel.interaction): the snapshot is now a list of generic
 * `ObjectSnapshot`s (any registered type), not just sticky notes.
 */
export function useBoardDoc(boardId: string | null): {
  doc: Y.Doc;
  objects: readonly ObjectSnapshot[];
  connectionState: ConnectionState;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() => snapshot(doc));
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const handler = () => {
      setObjects(snapshot(doc));
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

  return { doc, objects, connectionState };
}
