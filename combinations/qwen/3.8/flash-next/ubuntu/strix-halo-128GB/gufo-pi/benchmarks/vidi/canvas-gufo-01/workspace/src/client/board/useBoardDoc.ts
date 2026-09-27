// Yjs document + live connection for one board, with a React-observable note
// snapshot. Mounted once per board (story 5 guarantees BoardPage mounts it only
// in the Ready state).

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard } from '../sync/connectBoard';

export interface BoardDocState {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  provider: WebsocketProvider | null;
}

export function useBoardDoc(boardId: string): BoardDocState {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) docRef.current = new Y.Doc();
  const doc = docRef.current;

  const [notes, setNotes] = useState<readonly StickySnapshot[]>(() => snapshot(doc));
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  useEffect(() => {
    initDoc(doc);
    const refresh = (): void => setNotes(snapshot(doc));
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const meta = doc.getMap<unknown>('meta');
    objects.observeDeep(refresh);
    meta.observeDeep(refresh);
    refresh();

    const connection = connectBoard(boardId, doc);
    setProvider(connection.provider);

    return () => {
      connection.provider.destroy();
      objects.unobserveDeep(refresh);
      meta.unobserveDeep(refresh);
      setProvider(null);
    };
  }, [boardId, doc]);

  return useMemo(() => ({ doc, notes, provider }), [doc, notes, provider]);
}
