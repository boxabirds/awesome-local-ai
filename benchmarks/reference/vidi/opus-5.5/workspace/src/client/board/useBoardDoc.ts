import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  /** Immutable notes sorted by (z, id). Unchanged notes keep their object identity. */
  notes: readonly StickySnapshot[];
}

function sameNote(a: StickySnapshot, b: StickySnapshot): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.color === b.color &&
    a.text === b.text &&
    a.z === b.z &&
    a.createdAt === b.createdAt
  );
}

/**
 * Reuses the previous object for every note whose fields did not change, so memoised
 * note components skip re-rendering while another note is dragged (500-note boards).
 */
function reconcile(prev: readonly StickySnapshot[], next: readonly StickySnapshot[]): readonly StickySnapshot[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const out = next.map((note, i) => {
    const old = byId.get(note.id);
    const keep = old !== undefined && sameNote(old, note) ? old : note;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? out : prev;
}

/**
 * Owns this page's board `Y.Doc` (in memory only in this story; story 3 attaches a
 * network provider and story 4 persists the same document) and exposes an immutable
 * snapshot of its objects via useSyncExternalStore.
 */
export function useBoardDoc(): BoardDoc {
  const [doc] = useState(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  });
  const cacheRef = useRef<readonly StickySnapshot[] | null>(null);

  const getSnapshot = useCallback(() => {
    if (cacheRef.current === null) cacheRef.current = snapshot(doc);
    return cacheRef.current;
  }, [doc]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const onDeep = () => {
        cacheRef.current = reconcile(cacheRef.current ?? [], snapshot(doc));
        onChange();
      };
      objects.observeDeep(onDeep);
      // Catch changes made between the first render and subscribing.
      onDeep();
      return () => objects.unobserveDeep(onDeep);
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes };
}
