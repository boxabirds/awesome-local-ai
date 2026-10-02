/**
 * The React binding for the board document.
 *
 * One `Y.Doc` per board lives here for the lifetime of the component; every
 * mutation goes through `src/shared/board-model.ts`, and React renders an
 * immutable snapshot of it. The snapshot is recomputed only when the document
 * actually changes (`observeDeep`), and cached so `useSyncExternalStore` sees a
 * stable value between renders.
 *
 * Story 3 attaches a network provider to this same doc and story 4 persists it;
 * nothing about rendering changes when they do.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot, OBJECTS_KEY, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocHandle {
  readonly doc: Y.Doc;
  /** Notes in stacking order (z, id); frozen so React can compare by identity. */
  readonly notes: readonly StickySnapshot[];
}

interface BoardStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

/** Cheap structural comparison, so a no-op change keeps the cached identity. */
function sameNotes(
  left: readonly StickySnapshot[],
  right: readonly StickySnapshot[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((note, index) => {
    const other = right[index];
    return (
      !!other &&
      other.id === note.id &&
      other.x === note.x &&
      other.y === note.y &&
      other.z === note.z &&
      other.color === note.color &&
      other.text === note.text &&
      other.createdAt === note.createdAt
    );
  });
}

/** Create the store behind the hook: doc + memoised snapshot + subscription. */
export function createBoardStore(doc: Y.Doc = new Y.Doc()): BoardStore {
  initDoc(doc);
  const objects = doc.getMap(OBJECTS_KEY);
  const listeners = new Set<() => void>();
  let cached: readonly StickySnapshot[] = snapshot(doc);
  let attached = false;

  const handleDocumentChange = () => {
    const next = snapshot(doc);
    if (!sameNotes(cached, next)) cached = next;
    for (const listener of listeners) listener();
  };

  return {
    doc,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      if (!attached) {
        objects.observeDeep(handleDocumentChange);
        attached = true;
      }
      // Pick up anything written between the render and this subscription.
      const next = snapshot(doc);
      if (!sameNotes(cached, next)) cached = next;
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && attached) {
          objects.unobserveDeep(handleDocumentChange);
          attached = false;
        }
      };
    },
    getSnapshot: () => cached,
  };
}

/**
 * The board's document and its notes. Pass a doc to render one that already
 * exists (story 3's room, component tests); otherwise a fresh one is created.
 */
export function useBoardDoc(existing?: Y.Doc): BoardDocHandle {
  const [store] = useState<BoardStore>(() => createBoardStore(existing));
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(() => ({ doc: store.doc, notes }), [store, notes]);
}
