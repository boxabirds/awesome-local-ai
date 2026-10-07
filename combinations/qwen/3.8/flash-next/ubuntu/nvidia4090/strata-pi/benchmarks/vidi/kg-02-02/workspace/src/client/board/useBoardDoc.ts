import { useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { initDoc, snapshot, type StickySnapshot } from "../../shared/board-model";

/**
 * The board document, exposed to React as an immutable snapshot.
 *
 * `useSyncExternalStore` is used because the store is a Yjs document, not React
 * state: Yjs keeps the authoritative (mergeable, later shared and persisted)
 * content, and React only ever renders a snapshot of it that is recomputed on
 * `objects.observeDeep` — memoised so unrelated renders reuse the same array.
 */
export interface BoardStore {
  readonly doc: Y.Doc;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
}

/**
 * Wraps a `Y.Doc` (creating one when a test or caller does not pass a document)
 * in the store shape `useSyncExternalStore` needs.
 */
export function createBoardStore(doc?: Y.Doc): BoardStore {
  const document = doc ?? new Y.Doc();
  initDoc(document);

  const objects = document.getMap<Y.Map<unknown>>("objects");
  const listeners = new Set<() => void>();
  let cached: readonly StickySnapshot[] = snapshot(document);
  let dirty = false;

  const invalidate = () => {
    dirty = true;
    for (const listener of [...listeners]) listener();
  };
  // Observe at creation time so a change can never land between renders.
  objects.observeDeep(invalidate);

  const getSnapshot = () => {
    if (dirty) {
      cached = snapshot(document);
      dirty = false;
    }
    return cached;
  };

  return {
    doc: document,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
  };
}

export function useBoardStore(store: BoardStore): readonly StickySnapshot[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * The board document hook. Story 3 attaches a network provider to `doc` and
 * story 4 persists the very same document; nothing here changes.
 */
export function useBoardDoc(doc?: Y.Doc): BoardDoc {
  const storeRef = useRef<BoardStore | null>(null);
  if (storeRef.current === null) storeRef.current = createBoardStore(doc);
  const store = storeRef.current;

  return { doc: store.doc, notes: useBoardStore(store) };
}
