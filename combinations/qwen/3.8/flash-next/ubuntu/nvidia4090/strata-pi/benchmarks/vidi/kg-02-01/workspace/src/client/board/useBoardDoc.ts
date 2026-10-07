import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";
import {
  getObjectsMap,
  initDoc,
  snapshot,
  type StickySnapshot,
} from "../../shared/board-model";

/**
 * React view of the board document.
 *
 * Owns one `Y.Doc` (in memory in this story; story 3 attaches a network
 * provider to the same instance and story 4 persists it) and republishes an
 * immutable `snapshot()` through `useSyncExternalStore`, so React renders a
 * plain array without re-reading Yjs on every render.
 *
 * The snapshot is recomputed only when the document actually changes
 * (`objects.observeDeep`), and the previous array is reused otherwise, which
 * is what `useSyncExternalStore` requires.
 */
export interface BoardDocApi {
  /** The document itself: pass it to board-model mutations. */
  readonly doc: Y.Doc;
  /** Sticky notes in paint order `(z, id)`; unknown object types are skipped. */
  readonly notes: readonly StickySnapshot[];
  /** Look up one note (undefined once it has been deleted). */
  noteById(id: string | null): StickySnapshot | undefined;
}

interface SnapshotCache {
  dirty: boolean;
  notes: readonly StickySnapshot[];
  byId: Map<string, StickySnapshot>;
}

export function useBoardDoc(existing?: Y.Doc): BoardDocApi {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = existing ?? new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const cacheRef = useRef<SnapshotCache | null>(null);
  if (cacheRef.current === null) {
    const notes = snapshot(doc);
    cacheRef.current = { dirty: false, notes, byId: indexById(notes) };
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = getObjectsMap(doc);
      const observer = () => {
        cacheRef.current!.dirty = true;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => {
        objects.unobserveDeep(observer);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly StickySnapshot[] => {
    const cache = cacheRef.current!;
    if (cache.dirty) {
      const notes = snapshot(doc);
      cache.dirty = false;
      cache.notes = notes;
      cache.byId = indexById(notes);
    }
    return cache.notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const noteById = useCallback(
    (id: string | null) => (id === null ? undefined : cacheRef.current!.byId.get(id)),
    [],
  );

  return useMemo(() => ({ doc, notes, noteById }), [doc, notes, noteById]);
}

function indexById(notes: readonly StickySnapshot[]): Map<string, StickySnapshot> {
  const map = new Map<string, StickySnapshot>();
  for (const note of notes) map.set(note.id, note);
  return map;
}
