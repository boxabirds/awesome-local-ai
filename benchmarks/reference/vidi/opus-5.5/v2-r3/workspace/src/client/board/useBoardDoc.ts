import { useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { getObjectsMap, initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

/**
 * Wraps a Y.Doc as an external store whose snapshot is recomputed (once) on
 * every change to `objects`. Story 3 attaches a network provider to `doc`.
 */
class BoardStore {
  readonly doc: Y.Doc;
  private current: readonly StickySnapshot[];
  private readonly listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    initDoc(doc);
    this.current = snapshot(doc);
    getObjectsMap(doc).observeDeep(this.onChange);
  }

  private onChange = () => {
    this.current = snapshot(this.doc);
    for (const l of this.listeners) l();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.current;
}

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
}

/** Owns the board's Y.Doc (in memory only in this story) and its immutable snapshot. */
export function useBoardDoc(): BoardDoc {
  // The store observes its own doc for the doc's whole lifetime (both are
  // garbage-collected together), which keeps StrictMode effect replays safe.
  const [store] = useState(() => new BoardStore(new Y.Doc()));
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc: store.doc, notes };
}
