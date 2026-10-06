/**
 * React access to the board document.
 *
 * One `Y.Doc` per board, created here (story 3 attaches a network provider to the same
 * document, story 4 persists it - the app code in between does not change). Every Yjs
 * change, including changes inside a note's `Y.Text`, is turned into a new immutable
 * snapshot, which React reads through `useSyncExternalStore`.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  /** The shared document: pass it to the board-model mutations. */
  readonly doc: Y.Doc;
  /** The notes to render, in render order (recomputed when the document changes). */
  readonly notes: readonly StickySnapshot[];
  /** How the live connection to the other people on this board is doing (story 3). */
  readonly connection: ConnectionState;
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

/**
 * The board's document, the notes it currently holds, and the live connection to everybody
 * else on `boardId`.
 *
 * The provider writes other people's changes into the document, and this document's changes go
 * out through it, so nothing else in the app has to know that networking exists.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  // One document per board. It outlives re-renders and is deliberately never destroyed, so a
  // StrictMode remount cannot wipe the board; only a different board replaces it.
  const ref = useRef<{ boardId: string; doc: Y.Doc; store: SnapshotStore } | null>(null);
  if (!ref.current || ref.current.boardId !== boardId) {
    const doc = new Y.Doc();
    initDoc(doc);
    ref.current = { boardId, doc, store: createSnapshotStore(doc) };
  }
  const { doc, store } = ref.current;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  // the connection belongs to this document and this board, and closes when they go away
  useEffect(() => {
    const live = connectBoard(doc, boardId, setConnection);
    return () => live.destroy();
  }, [doc, boardId]);

  return { doc, notes, connection };
}
