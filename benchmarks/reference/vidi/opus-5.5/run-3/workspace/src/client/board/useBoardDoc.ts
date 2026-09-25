import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, objectSnapshot, type ObjectSnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

type Objects = readonly ObjectSnapshot[];

function sameObject(a: ObjectSnapshot, b: ObjectSnapshot): boolean {
  const ka = Object.keys(a) as Array<keyof ObjectSnapshot>;
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/**
 * Keeps unchanged notes (and the whole list, if nothing changed) identical to the previous snapshot,
 * so memoised object components only re-render when their own object changes.
 */
function shareStructure(prev: Objects, next: Objects): Objects {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const shared = next.map((n, i) => {
    const old = byId.get(n.id);
    const keep = old && sameObject(old, n) ? old : n;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? Object.freeze(shared) : prev;
}

interface SnapshotStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): Objects;
}

/** Observes `objects` only while someone is subscribed; recomputes the snapshot lazily after changes. */
function createSnapshotStore(doc: Y.Doc): SnapshotStore {
  const objects = doc.getMap('objects');
  const listeners = new Set<() => void>();
  let current: Objects = objectSnapshot(doc);
  let dirty = false;
  const observer = () => {
    dirty = true;
    listeners.forEach((l) => l());
  };
  return {
    subscribe(onChange) {
      if (listeners.size === 0) {
        objects.observeDeep(observer);
        dirty = true; // changes may have happened while nobody was observing
      }
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) objects.unobserveDeep(observer);
      };
    },
    getSnapshot() {
      if (dirty || listeners.size === 0) {
        dirty = false;
        current = shareStructure(current, objectSnapshot(doc));
      }
      return current;
    },
  };
}

/**
 * Owns the board's Y.Doc and exposes an immutable, (z, id)-sorted snapshot of its objects.
 * With a `boardId` the doc is kept in sync with that board's room (remote changes re-render through the
 * same observer as local ones) until unmount or board change. `existing` lets tests pass their own doc.
 */
export function useBoardDoc(
  boardId?: string,
  existing?: Y.Doc,
): { doc: Y.Doc; objects: Objects; connection: ConnectionState } {
  const [doc] = useState(() => {
    const d = existing ?? new Y.Doc();
    initDoc(d);
    return d;
  });
  const [store] = useState(() => createSnapshotStore(doc));
  const objects = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [connection, setConnection] = useState<ConnectionState>(boardId ? 'connecting' : 'connected');
  useEffect(() => {
    if (!boardId) return;
    const conn = connectBoard(doc, boardId, setConnection);
    return () => conn.destroy();
  }, [doc, boardId]);
  return { doc, objects, connection };
}
