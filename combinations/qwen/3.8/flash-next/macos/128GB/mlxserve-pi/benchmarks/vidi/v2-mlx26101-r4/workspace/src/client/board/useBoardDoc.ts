/**
 * Owns the board's `Y.Doc` and hands React an immutable snapshot of it.
 *
 * The document — not React state — is the source of truth, and it is the same
 * document story 3 will sync and story 4 will persist, so this hook is the one
 * place where a provider can later be attached. Nothing here is stored
 * anywhere: reloading the page loses the notes, which is story 4's job.
 *
 * `useSyncExternalStore` needs `getSnapshot` to return the identical value
 * until something changes, so the snapshot is computed lazily and cached, and
 * `objects.observeDeep` (which also fires for nested `Y.Map` and `Y.Text`
 * changes) only marks that cache dirty.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { registerBoardForTests } from '../canvas/testHooks';

export interface BoardDoc {
  /** The document every board mutation is applied to. */
  doc: Y.Doc;
  /** The notes to render, in stacking order; frozen, new only after a change. */
  notes: readonly StickySnapshot[];
}

interface BoardDocStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): BoardDoc;
}

function createBoardDocStore(): BoardDocStore {
  const doc = new Y.Doc();
  initDoc(doc);

  const listeners = new Set<() => void>();
  let cached: BoardDoc | null = null;

  const notify = (): void => {
    cached = null; // dirty: the next getSnapshot recomputes
    for (const listener of [...listeners]) listener();
  };

  // Deep, so a colour change, a move and a keystroke in `text` all arrive.
  doc.getMap<Y.Map<unknown>>('objects').observeDeep(notify);

  // Tests read the document the app itself created, rather than a copy of it.
  // `MODE` is a build-time constant, so this disappears from production builds.
  if (import.meta.env.MODE === 'test') registerBoardForTests(doc);

  return {
    doc,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      if (!cached) cached = { doc, notes: snapshot(doc) };
      return cached;
    },
  };
}

/**
 * One `Y.Doc` per board, re-rendered whenever the document changes.
 *
 * The store is held in a ref rather than created in a `useMemo` so React cannot
 * hand out two documents (StrictMode re-invokes renders, and a second `Y.Doc`
 * would silently split the board).
 */
export function useBoardDoc(): BoardDoc {
  const storeRef = useRef<BoardDocStore | null>(null);
  if (storeRef.current === null) storeRef.current = createBoardDocStore();
  const store = storeRef.current;

  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
