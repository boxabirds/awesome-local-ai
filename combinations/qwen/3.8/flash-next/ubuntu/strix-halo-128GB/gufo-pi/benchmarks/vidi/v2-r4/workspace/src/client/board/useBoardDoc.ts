import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Sticky notes sorted by (z, id); a new array only when the doc changed. */
  readonly notes: readonly StickySnapshot[];
  readonly connectionState: ConnectionState;
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
 * immutable snapshot through `useSyncExternalStore`. When a boardId is provided
 * it attaches a WebSocket provider for live collaboration.
 *
 * Passing a doc (component tests, future providers) uses that document instead
 * of creating one.
 */
export function useBoardDoc(external?: Y.Doc, boardId?: string): BoardDoc {
  const [store] = useState<DocStore>(() => new DocStore(external ?? createDoc()));
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    if (!boardId) {
      // No boardId: no connection needed (component tests etc.)
      setConnectionState('connected');
      return;
    }
    const conn = connectBoard(store.doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [store.doc, boardId]);

  return { doc: store.doc, notes, connectionState };
}
