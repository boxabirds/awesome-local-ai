import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { initDoc, snapshot, type StickySnapshot } from "../../shared/board-model";
import { connectBoard, type ConnectionState } from "../sync/connectBoard";

/**
 * Owns the board's `Y.Doc`, connects it to the board's room, and exposes an
 * immutable snapshot of its notes to React through `useSyncExternalStore`.
 *
 * Yjs is the source of truth; React re-renders when `objects.observeDeep`
 * fires — whether the change came from this client's keyboard or from the
 * room. The snapshot is memoised so `getSnapshot` returns the identical array
 * between renders (a new array every call would loop React forever) and is
 * recomputed only when the document actually changed.
 *
 * Story 4 persists this same document; nothing here changes.
 */
export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Notes sorted by (z, id) — the render order. */
  readonly notes: readonly StickySnapshot[];
  /** Live connection state, for the badge. `connecting` when not connected. */
  readonly connectionState: ConnectionState;
  /** Latest notes for event handlers that must not read a stale closure. */
  getNotes(): readonly StickySnapshot[];
  getNote(id: string): StickySnapshot | undefined;
}

export interface UseBoardDocOptions {
  /** Observe an existing document; component tests inject one. */
  readonly doc?: Y.Doc;
  /** The board to connect to. Without it the document stays local to this tab. */
  readonly boardId?: string;
}

export function useBoardDoc({ doc: provided, boardId }: UseBoardDocOptions = {}): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) docRef.current = provided ?? createDoc();
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (boardId === undefined) return;
    const connection = connectBoard(doc, boardId, setConnectionState);
    return () => connection.destroy();
  }, [doc, boardId]);

  /** Bumped on every document change; keys the snapshot cache. */
  const revisionRef = useRef(0);
  const cacheRef = useRef<{ revision: number; notes: readonly StickySnapshot[] } | null>(null);

  const currentNotes = useCallback((): readonly StickySnapshot[] => {
    const revision = revisionRef.current;
    let cache = cacheRef.current;
    if (!cache || cache.revision !== revision) {
      cache = { revision, notes: snapshot(doc) };
      cacheRef.current = cache;
    }
    return cache.notes;
  }, [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>("objects");
      const onChange = () => {
        revisionRef.current += 1;
        onStoreChange();
      };
      objects.observeDeep(onChange);
      return () => objects.unobserveDeep(onChange);
    },
    [doc],
  );

  const notes = useSyncExternalStore(
    subscribe,
    currentNotes,
    currentNotes,
  );

  const getNote = useCallback(
    (id: string): StickySnapshot | undefined => currentNotes().find((note) => note.id === id),
    [currentNotes],
  );

  return { doc, notes, connectionState, getNotes: currentNotes, getNote };
}

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}
