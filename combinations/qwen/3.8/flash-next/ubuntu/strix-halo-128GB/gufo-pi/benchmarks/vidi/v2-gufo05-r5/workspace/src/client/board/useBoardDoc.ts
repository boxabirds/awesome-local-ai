/**
 * React access to the board document.
 *
 * One `Y.Doc` per board, created here (story 3 attaches a network provider to the same
 * document, story 4 persists it - the app code in between does not change). Every Yjs
 * change, including changes inside a note's `Y.Text`, is turned into a new immutable
 * snapshot, which React reads through `useSyncExternalStore`.
 */
import { useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  /** The shared document: pass it to the board-model mutations. */
  readonly doc: Y.Doc;
  /** The notes to render, in render order (recomputed when the document changes). */
  readonly notes: readonly StickySnapshot[];
}

interface SnapshotStore {
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

/**
 * Mirrors the document into an immutable snapshot, recomputed once per Yjs change
 * (not once per component), so all subscribers see the same object.
 */
function createSnapshotStore(doc: Y.Doc): SnapshotStore {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let current: readonly StickySnapshot[] = snapshot(doc);
  const listeners = new Set<() => void>();

  objects.observeDeep(() => {
    current = snapshot(doc);
    for (const listener of listeners) listener();
  });

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return current;
    },
  };
}

/** The board's document and the notes it currently holds. */
export function useBoardDoc(): BoardDoc {
  // Created once per component instance; the document outlives re-renders and is
  // deliberately never destroyed, so a StrictMode remount cannot wipe the board.
  const ref = useRef<{ doc: Y.Doc; store: SnapshotStore } | null>(null);
  if (!ref.current) {
    const doc = new Y.Doc();
    initDoc(doc);
    ref.current = { doc, store: createSnapshotStore(doc) };
  }
  const { doc, store } = ref.current;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc, notes };
}
