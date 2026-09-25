/**
 * Owns the board's Y.Doc and exposes an immutable snapshot of its notes to React via
 * useSyncExternalStore (anchor: board.model). Story 3 attaches a network provider to
 * the same document; story 4 persists it.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, observeObjects, snapshot, type StickySnapshot } from '../../shared/board-model';

export interface BoardDocApi {
  doc: Y.Doc;
  /** Notes sorted by (z, id). Unchanged notes keep their object identity between updates. */
  notes: readonly StickySnapshot[];
}

function sameNote(a: StickySnapshot, b: StickySnapshot): boolean {
  return (
    a.id === b.id &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.color === b.color &&
    a.text === b.text &&
    a.createdAt === b.createdAt
  );
}

/** Reuses previous note objects that did not change so memoised components can skip work. */
function reuse(prev: readonly StickySnapshot[], next: readonly StickySnapshot[]): readonly StickySnapshot[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const out = next.map((n, i) => {
    const old = byId.get(n.id);
    const kept = old !== undefined && sameNote(old, n) ? old : n;
    if (kept !== prev[i]) changed = true;
    return kept;
  });
  return changed ? Object.freeze(out) : prev;
}

interface NotesStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly StickySnapshot[];
}

function createNotesStore(doc: Y.Doc): NotesStore {
  let notes = snapshot(doc);
  const listeners = new Set<() => void>();
  let unobserve: (() => void) | null = null;
  const refresh = () => {
    const next = reuse(notes, snapshot(doc));
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

/** Uses `existing` when given (tests, later: a synced doc), otherwise creates one Y.Doc. */
export function useBoardDoc(existing?: Y.Doc): BoardDocApi {
  const [doc] = useState<Y.Doc>(() => {
    const d = existing ?? new Y.Doc();
    initDoc(d);
    return d;
  });
  const store = useMemo(() => createNotesStore(doc), [doc]);
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { doc, notes };
}
