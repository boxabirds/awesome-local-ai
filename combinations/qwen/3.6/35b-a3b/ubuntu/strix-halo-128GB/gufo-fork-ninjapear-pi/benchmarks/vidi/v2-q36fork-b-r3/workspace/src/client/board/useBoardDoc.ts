import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot as snapshotFn } from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';

/**
 * Creates a Y.Doc, initialises it, and exposes a memoised snapshot via useSyncExternalStore.
 */
export function useBoardDoc(): {
  doc: Y.Doc;
  snapshot: readonly StickySnapshot[];
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current!;

  const [snap, setSnap] = useState(() => snapshotFn(doc));

  // Listen for deep changes on the objects map
  useEffect(() => {
    const objects = (doc as any).getMap('objects') as Y.Map<any>;
    const unsubDeep = (objects as any).observeDeep((_events: any) => {
      setSnap(snapshotFn(doc));
    });
    return () => unsubDeep();
  }, [doc]);

  return {
    doc,
    snapshot: snap,
  };
}
