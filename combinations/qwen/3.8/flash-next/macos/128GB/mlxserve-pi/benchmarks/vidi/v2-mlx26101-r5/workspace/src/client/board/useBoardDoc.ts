import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import {
  initDoc,
  OBJECTS_MAP,
  snapshot,
  type ObjectSnapshot,
} from '../../shared/board-model';

/** What `useBoardDoc` gives the board: the shared document and its snapshot. */
export interface BoardDoc {
  /** The one `Y.Doc` this page edits (story 3 attaches a provider to it). */
  doc: Y.Doc;
  /**
   * Every object on the board, of every type, sorted by `(z, id)`; a new array only when the document
   * changed. Story 7 made this "every object" rather than "every note": selection, marquee, group
   * drag and delete all walk the whole board, and a snapshot that left out the types this build cannot
   * draw would leave them unselectable by *select all* and invisible to a marquee.
   */
  snapshot: readonly ObjectSnapshot[];
}

/**
 * Owns the board's `Y.Doc` and republishes it to React as an immutable snapshot.
 *
 * The snapshot is memoised: `objects.observeDeep` clears the cache and notifies
 * `useSyncExternalStore`, so a re-render recomputes the snapshot only when the
 * document actually changed. Deep observation covers text edits (the `Y.Text` is
 * nested inside the object map). A plain `update` listener is attached as well,
 * so the cache can never go stale for a change the deep observer did not see.
 */
export function useBoardDoc(): BoardDoc {
  const [doc] = useState<Y.Doc>(() => {
    const created = new Y.Doc();
    initDoc(created);
    return created;
  });
  const cache = useRef<{ snapshot: readonly ObjectSnapshot[] | null }>({ snapshot: null });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap(OBJECTS_MAP);
      const invalidate = () => {
        cache.current.snapshot = null;
        onStoreChange();
      };
      objects.observeDeep(invalidate);
      doc.on('update', invalidate);
      return () => {
        objects.unobserveDeep(invalidate);
        doc.off('update', invalidate);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): readonly ObjectSnapshot[] => {
    if (cache.current.snapshot === null) cache.current.snapshot = snapshot(doc);
    return cache.current.snapshot;
  }, [doc]);

  const objects = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, snapshot: objects };
}
