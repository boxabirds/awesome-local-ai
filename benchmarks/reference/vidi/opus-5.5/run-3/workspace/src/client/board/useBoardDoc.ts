import { useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';

type Notes = readonly StickySnapshot[];

function sameNote(a: StickySnapshot, b: StickySnapshot): boolean {
  return (
    a.x === b.x && a.y === b.y && a.color === b.color && a.text === b.text && a.z === b.z && a.createdAt === b.createdAt
  );
}

/**
 * Keeps unchanged notes (and the whole list, if nothing changed) identical to the previous snapshot,
 * so memoised note components only re-render when their own note changes.
 */
function shareStructure(prev: Notes, next: Notes): Notes {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const shared = next.map((n, i) => {
    const old = byId.get(n.id);
    const keep = old && sameNote(old, n) ? old : n;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? Object.freeze(shared) : prev;
}

interface SnapshotStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): Notes;
}

/** Observes `objects` only while someone is subscribed; recomputes the snapshot lazily after changes. */
function createSnapshotStore(doc: Y.Doc): SnapshotStore {
  const objects = doc.getMap('objects');
  const listeners = new Set<() => void>();
  let current: Notes = snapshot(doc);
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
        current = shareStructure(current, snapshot(doc));
      }
      return current;
    },
  };
}

/**
 * Owns the board's Y.Doc (in memory in this story; story 3 attaches a provider, story 4 persists it)
 * and exposes an immutable, (z, id)-sorted snapshot of its notes. `existing` lets tests pass their own doc.
 */
export function useBoardDoc(existing?: Y.Doc): { doc: Y.Doc; notes: Notes } {
  const [doc] = useState(() => {
    const d = existing ?? new Y.Doc();
    initDoc(d);
    return d;
  });
  const [store] = useState(() => createSnapshotStore(doc));
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { doc, notes };
}
