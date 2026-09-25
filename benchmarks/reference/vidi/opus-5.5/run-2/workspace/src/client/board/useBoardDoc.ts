/**
 * Owns the board's Y.Doc and exposes an immutable snapshot of its objects to React via
 * useSyncExternalStore (anchor: board.model). With a `boardId` it also connects the
 * document to that board's room (anchor: sync.client); remote updates re-render through
 * the same observeDeep path as local changes. Story 4 persists it.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, observeObjects, snapshotObjects, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ProviderFactory } from '../sync/connectBoard';

export interface BoardDocApi {
  doc: Y.Doc;
  /**
   * Objects of every type sorted by (z, id). Unchanged objects keep their identity between
   * updates. Unknown types are included; the renderer and selection skip them.
   */
  objects: readonly ObjectSnapshot[];
  /** Sync connection state; 'connected' (badge hidden) when the board is local-only. */
  connection: ConnectionState;
}

function sameObject(a: ObjectSnapshot, b: ObjectSnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Reuses previous note objects that did not change so memoised components can skip work. */
function reuse(prev: readonly ObjectSnapshot[], next: readonly ObjectSnapshot[]): readonly ObjectSnapshot[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const out = next.map((n, i) => {
    const old = byId.get(n.id);
    const kept = old !== undefined && sameObject(old, n) ? old : n;
    if (kept !== prev[i]) changed = true;
    return kept;
  });
  return changed ? Object.freeze(out) : prev;
}

interface NotesStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ObjectSnapshot[];
}

function createNotesStore(doc: Y.Doc): NotesStore {
  let notes = snapshotObjects(doc);
  const listeners = new Set<() => void>();
  let unobserve: (() => void) | null = null;
  const refresh = () => {
    const next = reuse(notes, snapshotObjects(doc));
    if (next === notes) return;
    notes = next;
    listeners.forEach((l) => l());
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (unobserve === null) {
        unobserve = observeObjects(doc, refresh);
        refresh(); // catch changes made while nobody was subscribed
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unobserve !== null) {
          unobserve();
          unobserve = null;
        }
      };
    },
    getSnapshot: () => notes,
  };
}

export interface BoardDocOptions {
  /** Board to connect to. Omitted: a local-only document (component tests). */
  boardId?: string;
  /** Uses this document instead of creating one (tests). */
  doc?: Y.Doc;
  /** Replaces the y-websocket provider (component tests). */
  createProvider?: ProviderFactory;
}

export function useBoardDoc(options: BoardDocOptions = {}): BoardDocApi {
  const { boardId, createProvider } = options;
  const [doc] = useState<Y.Doc>(() => {
    const d = options.doc ?? new Y.Doc();
    // A live board is initialised after its first sync (below), so reopening a saved board
    // stores nothing new. Concurrent first sets of the same version converge.
    if (options.boardId === undefined) initDoc(d);
    return d;
  });
  const store = useMemo(() => createNotesStore(doc), [doc]);
  const objects = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>(boardId === undefined ? 'connected' : 'connecting');

  useEffect(() => {
    if (boardId === undefined) {
      setConnection('connected');
      return undefined;
    }
    const onState = (state: ConnectionState) => {
      if (state === 'connected') initDoc(doc); // no-op once the saved board carries a version
      setConnection(state);
    };
    const connection = connectBoard(doc, boardId, onState, createProvider);
    return () => connection.destroy();
  }, [doc, boardId, createProvider]);

  return { doc, objects, connection };
}
