import { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc { doc: Y.Doc; notes: readonly StickySnapshot[] }

export function useBoardDoc(): BoardDoc {
  const store = useMemo(() => {
    const doc = new Y.Doc();
    initDoc(doc);
    let current = snapshot(doc);
    const objects = doc.getMap('objects');
    return {
      doc,
      subscribe(cb: () => void) {
        const handler = () => { current = snapshot(doc); cb(); };
        objects.observeDeep(handler);
        return () => objects.unobserveDeep(handler);
      },
      get: () => current,
    };
  }, []);
  const notes = useSyncExternalStore(store.subscribe, store.get);
  return { doc: store.doc, notes };
}
