import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model.ts';
import { connectBoard, type BoardConnection } from './connectBoard.ts';
import { useConnectionBadge, type Subscribe } from './useConnectionBadge.ts';
import type { ConnectionStatusValue } from './useConnectionBadge.ts';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  connection: ConnectionStatusValue;
}

/**
 * Owns one Y.Doc, initialises its schema, and exposes an immutable sticky-note
 * snapshot through useSyncExternalStore. The snapshot is memoised and only
 * recomputed when the objects map (deep) changes. Story 3 attaches a network
 * provider to the same doc; story 4 persists it — no change needed here.
 *
 * `injected` lets component tests supply their own document (defaults to a fresh
 * one so production code calls `useBoardDoc()` with no arguments).
 */
export function useBoardDoc(injected?: Y.Doc, boardId?: string | null): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) docRef.current = injected ?? new Y.Doc();
  const doc = docRef.current;

  const cacheRef = useRef<readonly StickySnapshot[]>(snapshot(doc));
  const connRef = useRef<BoardConnection | null>(null);
  const [providerReady, setProviderReady] = useState(false);

  useEffect(() => {
    initDoc(doc);
    // Schema may have just been written; refresh the cache.
    cacheRef.current = snapshot(doc);
  }, [doc]);

  // Own the network provider. The Y.Doc instance never changes across
  // reconnects; only the provider is created/destroyed with the board. When no
  // board is bound (local/offline board, or an injected test doc) there is no
  // provider and the badge is treated as connected.
  useEffect(() => {
    if (!boardId || injected) {
      connRef.current = null;
      setProviderReady(false);
      return;
    }
    connRef.current = connectBoard(boardId, doc);
    setProviderReady(true);
    // Test-only: drive y-websocket's real disconnect/reconnect machinery so e2e
    // can exercise the idle-drop path (wrangler dev never drops an idle socket
    // itself). disconnect()/connect() run the same close + resync code as a
    // network drop and its recovery.
    if (typeof window !== 'undefined' && import.meta.env?.MODE === 'test') {
      window.__vidi6 ??= {} as Window['__vidi6'];
      window.__vidi6!.simulateDrop = () => connRef.current?.provider.disconnect();
      window.__vidi6!.restoreConnection = () => connRef.current?.provider.connect();
    }
    return () => {
      connRef.current?.destroy();
      connRef.current = null;
    };
  }, [boardId, injected, doc]);

  // Feed provider signals into the badge state machine. Recreated when the
  // provider is (re)created so the listeners attach to the live provider.
  const subscribeBadge = useCallback<Subscribe>(
    (emit) => {
      const provider = connRef.current?.provider;
      if (!provider) return () => {};
      // 'connected' signal = socket open AND synced (y-websocket 'sync' true);
      // 'disconnected' signal = provider status disconnected.
      const onSync = (synced: boolean) => {
        if (synced) emit('connected');
      };
      const onStatus = (s: { status: string }) => {
        if (s.status === 'disconnected') emit('disconnected');
      };
      provider.on('sync', onSync);
      provider.on('status', onStatus);
      return () => {
        provider.off('sync', onSync);
        provider.off('status', onStatus);
      };
    },
    [providerReady],
  );

  const connection = useConnectionBadge(subscribeBadge, providerReady);

  // Test build: mirror the mapped connection state so nightly e2e can assert it
  // never leaves `connected` while idle (design TC-29).
  useEffect(() => {
    if (typeof window !== 'undefined' && import.meta.env?.MODE === 'test' && window.__vidi6) {
      window.__vidi6.connectionState = connection;
    }
  }, [connection]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const handler = () => {
        cacheRef.current = snapshot(doc);
        onStoreChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback(() => cacheRef.current, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connection };
}
