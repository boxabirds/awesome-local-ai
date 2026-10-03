import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { OBJECTS_MAP, initDoc, snapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';

/**
 * The board document plus the notes it contains.
 *
 * The document is the single source of truth for board content; React never owns it.
 * `notes` is an immutable snapshot recomputed only when `objects` (or anything inside it)
 * changes, which is what `useSyncExternalStore` needs: a stable value between changes, so
 * rendering never re-derives the list.
 *
 * Story 3 attaches a network provider to `doc` and story 4 persists it; nothing here has
 * to change for that, which is the reason notes live in Yjs from the first story.
 */
export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Notes in render order (by `z`, then id). */
  readonly notes: readonly StickySnapshot[];
}

interface DocStore {
  readonly doc: Y.Doc;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
  /** Start observing the document (called on mount). */
  attach(): void;
  /** Stop observing the document (called on unmount). */
  detach(): void;
}

function createStore(injected?: Y.Doc): DocStore {
  const doc = injected ?? new Y.Doc();
  initDoc(doc);

  const listeners = new Set<() => void>();
  let current: readonly StickySnapshot[] = snapshot(doc);
  let observer: ((events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void) | null =
    null;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    doc,
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return current;
    },
    attach() {
      if (observer !== null) {
        return;
      }
      // Deep: a change to a note's Y.Text is as much a change to the board as a move.
      observer = () => {
        current = snapshot(doc);
        notify();
      };
      doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).observeDeep(observer);
      // Changes that happened while detached are not missed.
      current = snapshot(doc);
    },
    detach() {
      if (observer === null) {
        return;
      }
      doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).unobserveDeep(observer);
      observer = null;
    },
  };
}

/**
 * Own the board document for this component.
 *
 * @param initialDoc optional document to use instead of creating one. Tests pass their
 * own so they can drive the model directly; production calls leave it out.
 */
export function useBoardDoc(initialDoc?: Y.Doc): BoardDoc {
  const ref = useRef<DocStore | null>(null);
  if (ref.current === null) {
    ref.current = createStore(initialDoc);
  }
  const store = ref.current;
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    store.attach();
    return () => {
      store.detach();
    };
  }, [store]);

  return { doc: store.doc, notes };
}
