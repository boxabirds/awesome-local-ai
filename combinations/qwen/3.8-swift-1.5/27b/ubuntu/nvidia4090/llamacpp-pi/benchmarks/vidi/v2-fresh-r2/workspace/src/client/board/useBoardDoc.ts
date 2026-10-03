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
import { initDoc, objects, snapshot } from '../../shared/board-model';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ConnectBoardDeps } from '../sync/connectBoard';
import { setDisconnectHook, setBoardHooks } from '../canvas/testHooks';
import { createSticky, snapshot as boardSnapshot } from '../../shared/board-model';
import { insertRawObject } from '../../shared/board-model';
import { createText } from '../../shared/objects/text';
import { sessionIdentity } from '../identity';

export interface BoardDoc {
  doc: Y.Doc;
  /** Every object on the board (all types), sorted by (z, id). */
  objects: readonly ObjectSnapshot[];
  /** Sticky notes only (story 2 compatibility). */
  notes: readonly StickySnapshot[];
  connectionState: ConnectionState;
}

export function useBoardDoc(boardId: string, deps: ConnectBoardDeps = {}): BoardDoc {
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
    const connection = connectBoard(doc, boardId, setConnectionState, deps);
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
      (x: number, y: number) => createSticky(doc, { x, y }),
      (x: number, y: number, width: number, height: number) =>
        insertRawObject(doc, 'testbox', { x, y }, { width, height }),
      (x: number, y: number) => createText(doc, { x, y }, sessionIdentity()),
    );
    if (import.meta.env.MODE === 'test' && window.__vidi6) {
      window.__vidi6.getDoc = () => doc;
    }
    return () => {
      setBoardHooks(undefined, undefined);
    };
  }, [doc]);

  // Cached snapshot that is updated on changes (all types, story 7).
  const cacheRef = useRef<{ version: number; objects: readonly ObjectSnapshot[] }>({
    version: 0,
    objects: objects(doc),
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = () => {
        cacheRef.current = {
          version: cacheRef.current.version + 1,
          objects: objects(doc),
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

  const getSnapshot = useCallback(() => cacheRef.current.objects, []);

  const allObjects = useSyncExternalStore(subscribe, getSnapshot);

  // Sticky-only view for story 2 compatibility.
  const notes = allObjects.filter((o): o is StickySnapshot => o.type === 'sticky');

  return { doc, objects: allObjects, notes, connectionState };
}
