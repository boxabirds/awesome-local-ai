import { useCallback, useEffect, useRef, useSyncExternalStore, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, objectSnapshot, type ObjectSnapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  /** Every known board object (story 7 multi-type selection). */
  objects: readonly ObjectSnapshot[];
  /** Sticky notes only (story 2–5 API). */
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

interface BoardState {
  doc: Y.Doc;
  objects: readonly ObjectSnapshot[];
  boardId: string | undefined;
}

const EMPTY_OBJECTS: readonly ObjectSnapshot[] = [];

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
    stateRef.current = { doc, objects: objectSnapshot(doc), boardId };
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
      const objectsMap = doc.getMap('objects');
      const handler = () => {
        if (stateRef.current?.doc !== doc) return;
        stateRef.current.objects = objectSnapshot(doc);
        onChange();
      };
      objectsMap.observeDeep(handler);
      return () => {
        objectsMap.unobserveDeep(handler);
      };
    },
    [doc]
  );

  const getSnapshot = useCallback(() => stateRef.current?.objects ?? EMPTY_OBJECTS, []);

  const objects = useSyncExternalStore(subscribe, getSnapshot);

  // Sticky-only view (story 2–5 API); the array is fresh on every doc change,
  // so filtering per render is cheap and stable.
  const notes = objects.filter((o): o is StickySnapshot => o.type === 'sticky');

  return { doc, objects, notes, connectionState };
}

/**
 * Subscribes a component to the object snapshot of an existing Y.Doc. Used by
 * the story 7 gesture test harness (which supplies its own doc) and reusable
 * anywhere a doc is owned outside of useBoardDoc.
 */
export function useDocObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objectsRef = useRef<readonly ObjectSnapshot[]>(objectSnapshot(doc));
  const subscribe = useCallback(
    (onChange: () => void) => {
      const objectsMap = doc.getMap('objects');
      const handler = () => {
        objectsRef.current = objectSnapshot(doc);
        onChange();
      };
      objectsMap.observeDeep(handler);
      return () => {
        objectsMap.unobserveDeep(handler);
      };
    },
    [doc]
  );
  const getSnapshot = useCallback(
    () => objectsRef.current,
    []
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
