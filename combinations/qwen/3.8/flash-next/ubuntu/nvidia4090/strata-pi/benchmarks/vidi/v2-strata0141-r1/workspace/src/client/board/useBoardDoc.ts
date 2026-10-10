import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import {
  connectBoard,
  type BoardProvider,
  type ConnectionState,
} from '../sync/connectBoard';

/**
 * The board document, its render model, and its live connection.
 *
 * One `Y.Doc` per mounted board. Story 3 attaches the board's room to this same
 * document: local edits go out through the provider and other people's edits
 * come back into the same document, which is what re-renders the board.
 *
 * `snapshot()` is memoised and recomputed only when the document actually
 * changes, and it is exposed through `useSyncExternalStore` so React renders a
 * consistent, immutable view.
 */
export interface BoardDocOptions {
  /** A document to use instead of creating one (component tests). */
  doc?: Y.Doc;
  /** Which board this document is a copy of. */
  boardId: string;
  /** False keeps the connection away (component tests run without a server). */
  connect?: boolean;
  /**
   * The provider to reach the room with. Defaults to `y-websocket`; tests pass a
   * fake so a board can be driven through every connection state.
   */
  providerFactory?: (url: string, boardId: string, doc: Y.Doc) => BoardProvider;
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
  readonly connectionState: ConnectionState;
}

const EMPTY: readonly StickySnapshot[] = Object.freeze([] as StickySnapshot[]);

export function useBoardDoc({
  doc: providedDoc,
  boardId,
  connect = true,
  providerFactory,
}: BoardDocOptions): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = providedDoc ?? new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    connect ? 'connecting' : 'connected',
  );

  // The room connection belongs to this document's lifetime: it is opened when
  // the board mounts and destroyed when it unmounts, so a board that is no
  // longer on screen keeps no socket open and makes no reconnection attempts.
  useEffect(() => {
    if (!connect) {
      setConnectionState('connected');
      return;
    }
    const connection = connectBoard(doc, boardId, {
      onState: setConnectionState,
      provider: providerFactory,
    });
    return () => {
      connection.destroy();
    };
  }, [boardId, connect, doc, providerFactory]);

  // `null` means "dirty": the next read recomputes the snapshot.
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const subscribe = useCallback(
    (listener: () => void) => {
      const objects = doc.getMap<unknown>('objects');
      const handler = () => {
        cacheRef.current = null;
        listener();
      };
      // observeDeep also fires for nested Y.Text changes (typing on a note).
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    let notes = cacheRef.current;
    if (notes === null) {
      notes = snapshot(doc);
      cacheRef.current = notes;
    }
    return notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return { doc, notes, connectionState };
}
