import { useMemo, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/** Owns the Y.Doc (or adopts `external`) and exposes an immutable snapshot. */
export function useBoardDoc(external?: Y.Doc): BoardDoc {
  const doc = useMemo(() => {
    const d = external ?? new Y.Doc();
    initDoc(d);
    return d;
  }, [external]);

  const versionRef = useRef(0);
  const cache = useRef<{ doc: Y.Doc; version: number; value: readonly StickySnapshot[] } | null>(null);

  const subscribe = useMemo(() => (onChange: () => void) => {
    const objects = doc.getMap('objects');
    const handler = () => { versionRef.current += 1; onChange(); };
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc]);

  // Memoised per document version so useSyncExternalStore sees a stable reference.
  const getSnapshot = () => {
    const c = cache.current;
    if (c && c.doc === doc && c.version === versionRef.current) return c.value;
    const value = snapshot(doc);
    cache.current = { doc, version: versionRef.current, value };
    return value;
  };

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes };
}
