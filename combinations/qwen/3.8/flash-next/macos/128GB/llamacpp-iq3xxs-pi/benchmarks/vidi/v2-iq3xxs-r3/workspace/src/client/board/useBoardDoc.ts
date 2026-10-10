import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, OBJECTS_KEY, objectSnapshots, snapshot } from '../../shared/board-model';
import { connectBoard } from '../sync/connectBoard';
import type { BoardConnection, ConnectionState } from '../sync/connectBoard';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';

/** What the hook exposes: the live document plus an immutable render view. */
export interface BoardDoc {
  /** The document every mutation goes through, shared with the room. */
  readonly doc: Y.Doc;
  /** Notes sorted by (z, id); recomputed only when the doc changes. */
  readonly notes: readonly StickySnapshot[];
  /**
   * Every object on the board, whatever its type, sorted by (z, id): what the
   * selection, the marquee, the group gestures and the selection bar are
   * computed from. Types this build cannot draw are in here too — they are
   * someone else's object, and its rectangle is still known.
   */
  readonly objects: readonly ObjectSnapshot[];
  /** Live connection state of this board, as the badge shows it (live.status). */
  readonly connection: ConnectionState;
  /** The connection itself, or `null` while this board is offline by design. */
  readonly live: BoardConnection | null;
}

export interface UseBoardDocOptions {
  /**
   * Sync an already owned document instead of creating one, with no connection
   * (the component tests render a board from an injected `Y.Doc`).
   */
  readonly doc?: Y.Doc;
}

/**
 * Owns one board's `Y.Doc`, its live connection and the React view of it.
 *
 * `objects.observeDeep` invalidates the memoised `snapshot`; React pulls the
 * new value through `useSyncExternalStore`, so renders always see a consistent
 * immutable view — for local edits and for remote ones alike, because a remote
 * update lands in the same document (only its transaction origin differs).
 *
 * `boardId` picks the room (`/api/rooms/<boardId>`); changing it drops the
 * connection *and* the document, so one board's notes can never show up in
 * another board's view. `null` means "no board yet" (a redirect is on its way),
 * which stays offline.
 */
export function useBoardDoc(
  boardId: string | null,
  { doc: injected }: UseBoardDocOptions = {},
): BoardDoc {
  const doc = useMemo(() => {
    const created = injected ?? new Y.Doc();
    initDoc(created);
    return created;
  }, [injected, boardId]);

  // One observation of the shared map, feeding two views of it: the notes the
  // board draws, and every object the selection machinery needs. They are read
  // through `useSyncExternalStore` so a render always sees one consistent version
  // of the document, wherever the change came from.
  const store = useMemo(() => {
    let cached: { readonly notes: readonly StickySnapshot[]; readonly objects: readonly ObjectSnapshot[] } | undefined;
    const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
    return {
      subscribe(onChange: () => void): () => void {
        const invalidate = (): void => {
          cached = undefined;
          onChange();
        };
        objects.observeDeep(invalidate);
        return () => objects.unobserveDeep(invalidate);
      },
      getSnapshot(): { readonly notes: readonly StickySnapshot[]; readonly objects: readonly ObjectSnapshot[] } {
        if (cached === undefined) cached = { notes: snapshot(doc), objects: objectSnapshots(doc) };
        return cached;
      },
    };
  }, [doc]);

  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { notes, objects } = view;

  // The state machine starts where the design's diagram starts: a board that
  // has just been opened has not synced yet, whatever it says on screen a
  // moment later. Starting at `connected` would hide the badge before the first
  // sync and let a test believe it is in the room before it is in the room.
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [live, setLive] = useState<BoardConnection | null>(null);
  useEffect(() => {
    // Offline by construction: an injected document, or no board id yet.
    if (injected !== undefined || boardId === null) {
      setConnection('connected');
      return;
    }
    setConnection('connecting');
    const handle = connectBoard(doc, boardId, setConnection);
    setLive(handle);
    return () => {
      setLive(null);
      handle.destroy();
    };
  }, [doc, boardId, injected]);

  return { doc, notes, objects, connection, live };
}
