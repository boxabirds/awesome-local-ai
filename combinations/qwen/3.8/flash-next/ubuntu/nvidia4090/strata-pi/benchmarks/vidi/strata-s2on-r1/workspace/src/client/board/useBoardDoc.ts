import { useMemo, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { initDoc, snapshot, type StickySnapshot } from "../../shared/board-model";

/**
 * The board document store: one `Y.Doc` plus an immutable, memoised snapshot
 * that React renders through `useSyncExternalStore`.
 *
 * Story 3 attaches a network provider to the same document and story 4 persists
 * it; nothing else about this hook changes.
 */
export interface BoardStore {
  readonly doc: Y.Doc;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

export interface BoardDocState {
  readonly doc: Y.Doc;
  readonly notes: readonly StickySnapshot[];
}

const stores = new WeakMap<Y.Doc, BoardStore>();

/** Creates (once per doc) the store that turns Y.Doc changes into snapshots. */
export function createBoardStore(doc: Y.Doc): BoardStore {
  const existing = stores.get(doc);
  if (existing) return existing;

  initDoc(doc);

  const listeners = new Set<() => void>();
  let current: readonly StickySnapshot[] = snapshot(doc);

  const recompute = () => {
    const next = snapshot(doc);
    if (isSameSnapshot(current, next)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };

  // observeDeep: note fields *and* Y.Text edits land in one snapshot pass.
  doc.getMap<Y.Map<unknown>>("objects").observeDeep(recompute);

  const store: BoardStore = {
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

  stores.set(doc, store);
  return store;
}

/**
 * React view of the board document. Pass a doc to render a board whose document
 * is owned elsewhere (tests, and later the synced/persisted document); without
 * one, this page owns a fresh in-memory document.
 */
export function useBoardDoc(providedDoc?: Y.Doc): BoardDocState {
  const doc = useMemo(() => providedDoc ?? new Y.Doc(), [providedDoc]);
  const store = useMemo(() => createBoardStore(doc), [doc]);
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc, notes };
}

function isSameSnapshot(
  a: readonly StickySnapshot[],
  b: readonly StickySnapshot[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((note, index) => {
    const other = b[index];
    return (
      other !== undefined &&
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
