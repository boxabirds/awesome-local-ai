import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot as snapshotFn } from '@shared/board-model';
import type { ObjectSnap } from '@shared/board-model';
import { connectBoard } from '../sync/connectBoard';

/**
 * Creates a Y.Doc initialised for a board, connects via WebSocket,
 * and exposes a memoised snapshot via state.
 */
export function useBoardDoc(boardId: string): {
  doc: Y.Doc;
  snapshot: readonly ObjectSnap[];
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current!;

  const [snap, setSnap] = useState(() => snapshotFn(doc));

  // Listen for deep changes on the objects map
  useEffect(() => {
    const objects = (doc as any).getMap('objects') as Y.Map<any>;
    const unsubDeep = (objects as any).observeDeep((_events: any) => {
      setSnap(snapshotFn(doc));
    });
    return () => unsubDeep();
  }, [doc]);

  // Connect the WebSocket provider
  useEffect(() => {
    const { destroy } = connectBoard(doc, boardId, () => {});
    return destroy;
  }, [doc, boardId]);

  return {
    doc,
    snapshot: snap,
  };
}
