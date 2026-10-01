import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { getObjects, initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocApi {
  /** The single Y.Doc of this board (story 3 attaches a provider, story 4 persists it). */
  doc: Y.Doc;
  /** Immutable notes, sorted by (z, id); a new array only when the document changed. */
  notes: readonly StickySnapshot[];
}

/**
 * Owns the board's Y.Doc (created once per component instance, initialised
 * with the schema) and exposes it to React as an immutable snapshot.
 *
 * `objects.observeDeep` fires for adds, deletes, field changes *and* nested
 * Y.Text edits, so one subscription covers every render-relevant change. The
 * snapshot is memoised against a version counter so `useSyncExternalStore`
 * sees a stable reference between changes.
 */
export function useBoardDoc(): BoardDocApi {
  const [doc] = useState<Y.Doc>(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  });

  const versionRef = useRef(0);
  const cacheRef = useRef<{ version: number; notes: readonly StickySnapshot[] }>({
    version: -1,
    notes: [],
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = getObjects(doc);
      const observer = () => {
        versionRef.current++;
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
    const cache = cacheRef.current;
    if (cache.version !== versionRef.current) {
      cacheRef.current = { version: versionRef.current, notes: snapshot(doc) };
    }
    return cacheRef.current.notes;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
