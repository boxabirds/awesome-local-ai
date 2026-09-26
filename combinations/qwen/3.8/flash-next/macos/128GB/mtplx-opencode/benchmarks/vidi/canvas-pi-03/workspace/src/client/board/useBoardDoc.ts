import { useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * An immutable snapshot store backed by one Y.Doc. The snapshot is recomputed
 * only when the document actually changes (via `objects.observeDeep`), so
 * `getSnapshot` returns a referentially stable value between changes — the
 * invariant `useSyncExternalStore` requires.
 */
export interface BoardStore {
  doc: Y.Doc;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

function createBoardStore(): BoardStore {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let current = snapshot(doc);
  const listeners = new Set<() => void>();

  // One deep observer drives every snapshot refresh (positions, colours, text
  // and add/remove all live under `objects`).
  const observer = () => {
    current = snapshot(doc);
    listeners.forEach((l) => l());
  };
  objects.observeDeep(observer);

  return {
    doc,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return current;
    },
  };
}

/**
 * Owns one Y.Doc for the component's lifetime and exposes its latest snapshot.
 * Story 3 attaches a network provider to the returned `doc`; story 4 persists
 * it — neither is wired up in this story.
 */
export function useBoardDoc(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  // Create the store once per instance. A ref guard (rather than useMemo or a
  // lazy useState) keeps this to a single Y.Doc even under React StrictMode's
  // double render.
  const ref = useRef<BoardStore | null>(null);
  if (ref.current === null) ref.current = createBoardStore();
  const store = ref.current;

  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return { doc: store.doc, notes };
}