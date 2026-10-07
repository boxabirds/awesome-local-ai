import { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { snapshot, initDoc } from '@/shared/board-model';

let docRef: Y.Doc | null = null;

/**
 * Create or reuse a single Y.Doc instance.
 * Exposes immutable snapshots via local React state updates.
 */
export function useBoardDoc(): { doc: Y.Doc; snap: readonly unknown[] } {
  const [snap, setSnap] = useState(() => Object.freeze(snapshot(new Y.Doc())));

  if (!docRef) {
    docRef = new Y.Doc();
    initDoc(docRef);
    setSnap(Object.freeze(snapshot(docRef)));
  }

  // Subscribe to deep changes on the objects map
  useEffect(() => {
    const objectsMap = docRef!.getMap('objects');
    const handler = () => {
      setSnap(Object.freeze(snapshot(docRef!)));
    };
    objectsMap.observeDeep(handler);
    return () => {
      objectsMap.unobserveDeep(handler);
    };
  }, []);

  return { doc: docRef!, snap };
}
