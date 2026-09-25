import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../shared/board-model';
import type { Snapshot } from '../../shared/board-model';
import { installNotesHook, installTextsHook, setConnectionState } from '../canvas/testHooks';
import { snapshotText } from '../../shared/objects/text';
import type { ConnectionState } from '../sync/connectBoard';
import { connectBoard } from '../sync/connectBoard';

export interface BoardDoc {
  /** The in-memory board document (story 3 attaches the provider, story 4 persists it). */
  doc: Y.Doc;
  /** Immutable snapshots of the board objects, sorted by (z, id). */
  notes: Snapshot;
  /** The live connection phase, or null in local-only mode (no board id). */
  connectionPhase: ConnectionState | null;
}

/**
 * Owns the app's single `Y.Doc`, the live connection to the board room
 * (when a board id is given) and the immutable snapshot of the sticky
 * notes via `useSyncExternalStore`.
 *
 * The snapshot is memoised and only recomputed when `objects` changes
 * (observeDeep: the map, its nested object maps and the nested Y.Texts).
 */
export function useBoardDoc(boardId: string | null = null): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const cacheRef = useRef<{ dirty: boolean; value: Snapshot } | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = { dirty: false, value: snapshot(doc) };
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = (): void => {
        cacheRef.current!.dirty = true;
        onStoreChange();
      };
      doc.getMap('objects').observeDeep(handler);
      return () => {
        doc.getMap('objects').unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): Snapshot => {
    const cache = cacheRef.current!;
    if (cache.dirty) {
      cache.value = snapshot(doc);
      cache.dirty = false;
    }
    return cache.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  // Test hook: e2e tests read the note list (positions, z, colour, text).
  useEffect(() => {
    installNotesHook(() => snapshot(doc));
    // Story 9: e2e tests read text object snapshots.
    installTextsHook(() => {
      const snap = snapshot(doc);
      const texts = [];
      for (const o of snap) {
        if (o.type === 'text') {
          const t = snapshotText(doc, o.id);
          if (t) texts.push(t);
        }
      }
      return texts;
    });
  }, [doc]);

  // Live connection (task 4): one provider per board id for the life of the
  // page. Without a board id the app stays fully local (badge hidden).
  const [connectionPhase, setConnectionPhase] = useState<ConnectionState | null>(
    boardId !== null ? 'connecting' : null,
  );
  useEffect(() => {
    setConnectionState(null);
    if (boardId === null) {
      setConnectionPhase(null);
      return;
    }
    const connection = connectBoard({ boardId, doc });
    const unsubscribe = connection.subscribe((phase) => {
      setConnectionState(phase);
      setConnectionPhase(phase);
    });
    return () => {
      unsubscribe();
      connection.destroy();
    };
  }, [boardId, doc]);

  return { doc, notes, connectionPhase };
}
