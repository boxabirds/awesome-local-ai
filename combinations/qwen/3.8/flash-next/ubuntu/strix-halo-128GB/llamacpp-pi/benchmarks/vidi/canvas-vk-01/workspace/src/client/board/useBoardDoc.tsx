import { createContext, useContext, type ReactNode, type JSX } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { useSyncExternalStore, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { reportConnectionState } from '../canvas/testHooks';

export interface BoardDocContextValue {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  /** Live connection to the room; `connected` when there is nothing to sync. */
  connection: ConnectionState;
}

const BoardDocContext = createContext<BoardDocContextValue | null>(null);

export interface BoardDocProviderProps {
  children?: ReactNode;
  /** Provide an existing doc (for testing). */
  doc?: Y.Doc;
  /**
   * Board id from `/b/:boardId`. When given, the doc is connected to that
   * board's room and stays in sync with everyone else on it. Without it the
   * board is local only (component tests).
   */
  boardId?: string;
}

/**
 * Provides a single Y.Doc instance to the entire board subtree, kept in sync
 * with the board's room while `boardId` is set.
 */
export function BoardDocProvider({
  children,
  doc: externalDoc,
  boardId,
}: BoardDocProviderProps): JSX.Element {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    if (externalDoc) {
      docRef.current = externalDoc;
    } else {
      const doc = new Y.Doc();
      initDoc(doc);
      docRef.current = doc;
    }
  }
  const doc = docRef.current;
  const objectsMap = doc.getMap('objects') as unknown as Y.Map<unknown>;

  const subscribe = useMemo(() => {
    return (onStoreChange: () => void) => {
      objectsMap.observeDeep(onStoreChange);
      return () => {
        objectsMap.unobserveDeep(onStoreChange);
      };
    };
  }, [objectsMap]);

  const cachedRef = useRef<{ value: readonly StickySnapshot[]; dirty: boolean }>({ value: [], dirty: true });

  useEffect(() => {
    const handler = () => { cachedRef.current.dirty = true; };
    objectsMap.observeDeep(handler);
    return () => { objectsMap.unobserveDeep(handler); };
  }, [objectsMap]);

  const getSnapshot = useMemo(() => {
    return () => {
      if (cachedRef.current.dirty) {
        cachedRef.current.value = snapshot(doc);
        cachedRef.current.dirty = false;
      }
      return cachedRef.current.value;
    };
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [connection, setConnection] = useState<ConnectionState>(
    boardId === undefined ? 'connected' : 'connecting',
  );

  const report = useCallback((state: ConnectionState) => {
    setConnection(state);
    reportConnectionState(state);
  }, []);

  // Attach the provider to the doc; detach on unmount and whenever the board
  // changes. Remote updates flow through the same `observeDeep` subscription
  // as local ones, so the board re-renders exactly as it does for local edits.
  useEffect(() => {
    if (boardId === undefined) {
      setConnection('connected');
      return;
    }
    const handle = connectBoard(doc, boardId, report);
    return () => {
      handle.destroy();
    };
  }, [doc, boardId, report]);

  return (
    <BoardDocContext.Provider value={{ doc, notes, connection }}>
      {children}
    </BoardDocContext.Provider>
  );
}

/** Access the shared board document and its current snapshot. */
export function useBoardDoc(): BoardDocContextValue {
  const ctx = useContext(BoardDocContext);
  if (ctx === null) {
    throw new Error('useBoardDoc must be used within BoardDocProvider');
  }
  return ctx;
}
