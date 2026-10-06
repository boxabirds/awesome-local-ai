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
import { initDoc, snapshot, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { createUndo, type UndoController } from './undo';

export interface BoardDoc {
  /** The shared document: pass it to the board-model mutations. */
  readonly doc: Y.Doc;
  /**
   * Every board object, in render order (recomputed when the document changes). Selection,
   * marquee and undo work on this list; a screen splits it by `type` to render.
   */
  readonly objects: readonly ObjectSnapshot[];
  /** How the live connection to the other people on this board is doing (story 3). */
  readonly connection: ConnectionState;
  /**
   * This person's history on this board (story 8). It belongs here, next to the document its
   * steps are made of: leaving the board throws it away, and a reload starts empty.
   */
  readonly undo: UndoController;
}

interface SnapshotStore {
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly ObjectSnapshot[];
}

/**
 * Mirrors the document into an immutable snapshot, recomputed once per Yjs change
 * (not once per component), so all subscribers see the same object.
 */
function createSnapshotStore(doc: Y.Doc): SnapshotStore {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let current: readonly ObjectSnapshot[] = snapshot(doc);
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
 * The board's document, the objects it currently holds, and the live connection to everybody
 * else on `boardId`.
 *
 * The provider writes other people's changes into the document, and this document's changes go
 * out through it, so nothing else in the app has to know that networking exists.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  // One document per board. It outlives re-renders and is deliberately never destroyed, so a
  // StrictMode remount cannot wipe the board; only a different board replaces it.
  const ref = useRef<{ boardId: string; doc: Y.Doc; store: SnapshotStore; undo: UndoController } | null>(
    null,
  );
  // A board this screen has moved off is torn down after the next one is on screen - never during
  // a render, so a StrictMode double render cannot destroy a history something still points at.
  const retired = useRef<{ doc: Y.Doc; undo: UndoController }[]>([]);
  if (!ref.current || ref.current.boardId !== boardId) {
    const doc = new Y.Doc();
    initDoc(doc);
    if (ref.current) retired.current.push({ doc: ref.current.doc, undo: ref.current.undo });
    ref.current = { boardId, doc, store: createSnapshotStore(doc), undo: createUndo(doc) };
  }
  const { doc, store, undo } = ref.current;
  const objects = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  // the connection belongs to this document and this board, and closes when they go away
  useEffect(() => {
    const live = connectBoard(doc, boardId, setConnection);
    return () => live.destroy();
  }, [doc, boardId]);

  useEffect(() => {
    // let go of the boards this screen has moved on from
    const stale = retired.current;
    retired.current = [];
    for (const old of stale) {
      old.undo.destroy();
      old.doc.destroy();
    }
  });

  return { doc, objects, connection, undo };
}
