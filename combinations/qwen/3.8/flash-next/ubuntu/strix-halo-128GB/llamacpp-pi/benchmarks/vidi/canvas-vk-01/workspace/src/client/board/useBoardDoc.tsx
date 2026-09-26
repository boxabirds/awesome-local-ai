import { createContext, useContext, type ReactNode, type JSX } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { useSyncExternalStore, useRef, useMemo, useEffect } from 'react';

export interface BoardDocContextValue {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

const BoardDocContext = createContext<BoardDocContextValue | null>(null);

export interface BoardDocProviderProps {
  children?: ReactNode;
  /** Provide an existing doc (for testing). */
  doc?: Y.Doc;
}

/**
 * Provides a single Y.Doc instance to the entire board subtree.
 */
export function BoardDocProvider({ children, doc: externalDoc }: BoardDocProviderProps): JSX.Element {
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

  return (
    <BoardDocContext.Provider value={{ doc, notes }}>
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
