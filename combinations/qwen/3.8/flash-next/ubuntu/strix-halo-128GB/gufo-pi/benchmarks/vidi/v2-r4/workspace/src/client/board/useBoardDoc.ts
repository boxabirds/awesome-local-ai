import { useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Sticky notes sorted by (z, id); a new array only when the doc changed. */
  readonly notes: readonly StickySnapshot[];
}

function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * Keeps a memoised `snapshot()` beside the doc and invalidates it on every deep
 * observation, so `useSyncExternalStore` sees a stable reference between
 * changes.
 */
class DocStore {
  readonly doc: Y.Doc;
  private cached: readonly StickySnapshot[] | null = null;

  constructor(doc: Y.Doc) {
    this.doc = doc;
  }

  subscribe = (onChange: () => void): (() => void) => {
    const observer = () => {
      this.cached = null;
      onChange();
    };
    this.doc.getMap('objects').observeDeep(observer);
    return () => this.doc.getMap('objects').unobserveDeep(observer);
  };

  getSnapshot = (): readonly StickySnapshot[] => {
    if (this.cached === null) this.cached = snapshot(this.doc);
    return this.cached;
  };
}

/**
 * Owns the board's `Y.Doc` for this page and exposes its sticky notes as an
 * immutable snapshot through `useSyncExternalStore`. Story 3 attaches a network
 * provider to the same doc; story 4 persists it — this hook's API does not
 * change. Passing a doc (component tests, future providers) uses that document
 * instead of creating one.
 */
export function useBoardDoc(external?: Y.Doc): BoardDoc {
  const [store] = useState<DocStore>(() => new DocStore(external ?? createDoc()));
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc: store.doc, notes };
}
