import { useCallback, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { initDoc, snapshot, type StickySnapshot } from "../../shared/board-model";

/**
 * Owns the board's `Y.Doc` and exposes an immutable snapshot of its notes to
 * React through `useSyncExternalStore`.
 *
 * Yjs is the source of truth; React re-renders when `objects.observeDeep`
 * fires. The snapshot is memoised so `getSnapshot` returns the identical array
 * between renders (a new array every call would loop React forever) and is
 * recomputed only when the document actually changed.
 *
 * Story 3 attaches a network provider to `doc` and story 4 persists the very
 * same document; nothing here changes.
 */
export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Notes sorted by (z, id) — the render order. */
  readonly notes: readonly StickySnapshot[];
  /** Latest notes for event handlers that must not read a stale closure. */
  getNotes(): readonly StickySnapshot[];
  getNote(id: string): StickySnapshot | undefined;
}

/**
 * @param provided an existing document to observe (component tests inject one);
 * by default a fresh local document is created for this client.
 */
export function useBoardDoc(provided?: Y.Doc): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) docRef.current = provided ?? createDoc();
  const doc = docRef.current;

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

  return { doc, notes, getNotes: currentNotes, getNote };
}

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}
