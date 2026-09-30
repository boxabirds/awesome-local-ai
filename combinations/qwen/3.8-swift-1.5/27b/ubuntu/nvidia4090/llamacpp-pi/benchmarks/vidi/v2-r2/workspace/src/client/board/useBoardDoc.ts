import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/**
 * Owns the in-memory Y.Doc and exposes an immutable snapshot of the board via
 * useSyncExternalStore. Story 3 attaches a network provider to the same doc;
 * story 4 persists it. No network or storage in this story.
 */
export function useBoardDoc(): BoardDoc {
  const stateRef = useRef<{ doc: Y.Doc; notes: readonly StickySnapshot[] } | null>(null);
  if (stateRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    stateRef.current = { doc, notes: snapshot(doc) };
  }
  const { doc } = stateRef.current;

  useEffect(() => {
    return () => {
      doc.destroy();
      if (stateRef.current?.doc === doc) {
        stateRef.current = null;
      }
    };
  }, [doc]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const handler = () => {
        if (stateRef.current?.doc !== doc) return;
        stateRef.current.notes = snapshot(doc);
        onChange();
      };
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc]
  );

  const getSnapshot = useCallback(() => stateRef.current?.notes ?? EMPTY_NOTES, []);

  const notes = useSyncExternalStore(subscribe, getSnapshot);
  return { doc, notes };
}

const EMPTY_NOTES: readonly StickySnapshot[] = [];
