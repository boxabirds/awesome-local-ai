import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type StickySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState, type ProviderFactory } from '../sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  /** Immutable notes sorted by (z, id). Unchanged notes keep their object identity. */
  notes: readonly StickySnapshot[];
  /** Connection to the board's room, for the status badge. */
  connection: ConnectionState;
}

function sameNote(a: StickySnapshot, b: StickySnapshot): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.color === b.color &&
    a.text === b.text &&
    a.z === b.z &&
    a.createdAt === b.createdAt
  );
}

/**
 * Reuses the previous object for every note whose fields did not change, so memoised
 * note components skip re-rendering while another note is dragged (500-note boards).
 */
function reconcile(prev: readonly StickySnapshot[], next: readonly StickySnapshot[]): readonly StickySnapshot[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const out = next.map((note, i) => {
    const old = byId.get(note.id);
    const keep = old !== undefined && sameNote(old, note) ? old : note;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? out : prev;
}

/**
 * Owns this page's copy of board `boardId`'s `Y.Doc`, keeps it connected to the board's room
 * (remote changes arrive through the provider and re-render exactly like local ones), and
 * exposes an immutable snapshot of its objects via useSyncExternalStore. The provider is
 * destroyed on unmount or board change. Nothing is persisted locally (story 13).
 */
export function useBoardDoc(boardId: string, createProvider?: ProviderFactory): BoardDoc {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
    // A new board gets a new document.
  }, [boardId]);
  const cacheRef = useRef<{ doc: Y.Doc; notes: readonly StickySnapshot[] } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const link = connectBoard(doc, boardId, setConnection, createProvider);
    return () => link.destroy();
  }, [doc, boardId, createProvider]);

  const getSnapshot = useCallback(() => {
    if (cacheRef.current?.doc !== doc) cacheRef.current = { doc, notes: snapshot(doc) };
    return cacheRef.current.notes;
  }, [doc]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const objects = doc.getMap('objects');
      const onDeep = () => {
        const prev = cacheRef.current?.doc === doc ? cacheRef.current.notes : [];
        cacheRef.current = { doc, notes: reconcile(prev, snapshot(doc)) };
        onChange();
      };
      objects.observeDeep(onDeep);
      // Catch changes made between the first render and subscribing.
      onDeep();
      return () => objects.unobserveDeep(onDeep);
    },
    [doc],
  );

  const notes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { doc, notes, connection };
}
