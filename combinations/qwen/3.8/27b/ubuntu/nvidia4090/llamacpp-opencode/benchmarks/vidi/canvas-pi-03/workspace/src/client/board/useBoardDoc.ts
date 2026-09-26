import { useLayoutEffect, useMemo, useState } from 'react';

import * as Y from 'yjs';
import {
  initDoc,
  objectSnapshot,
  stickyNotes,
  type ObjectSnapshot,
  type StickySnapshot,
} from '@/shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';
import { registerConnectionTestHook } from '../canvas/testHooks';

export interface BoardDoc {
  /** The in-memory Yjs document (a fresh doc per board id). */
  doc: Y.Doc;
  /**
   * Immutable snapshot of ALL objects in the doc, known and unknown types,
   * sorted by (z, id) (story 7: the registry decides what renders and how).
   */
  objects: readonly ObjectSnapshot[];
  /** Sticky subset of `objects` (story 2; e2e hooks key off it). */
  notes: readonly StickySnapshot[];
  /** Live connection state for the board's sync provider. */
  connectionState: ConnectionState;
}

/**
 * Owns the board's Y.Doc for this page and exposes immutable snapshots.
 *
 * The doc is created per `boardId` and a y-websocket provider is attached for
 * the lifetime of the board (story 3), so local and remote edits both flow
 * through `doc`.
 *
 * Snapshot subscription is done in a LAYOUT effect (not
 * `useSyncExternalStore`, whose subscription is installed in the *passive*
 * phase): between commit and the passive phase there is a window in which a
 * committed doc change would not yet trigger a render. Story 7's
 * deterministic multi-object editing (gestures and keyboard acting on what is
 * on screen) needs "the doc changed" and "React rendered it" to be one
 * atomic step, so the observer is live before the board's DOM is observable.
 */
export function useBoardDoc(boardId: string): BoardDoc {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    initDoc(d);
    return d;
  }, [boardId]);

  // (Re)connect the sync provider whenever the doc/board changes.
  // Layout effect (not passive): the provider must exist by the time the
  // board's DOM is observable, so tests (and early user input) never talk to
  // a stale/destroyed provider from a previous board.
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  useLayoutEffect(() => {
    setConnectionState('connecting');
    const conn = connectBoard(doc, boardId, setConnectionState);
    // Test-only: expose handles to drop/resume the connection (story 3 outage test).
    if (import.meta.env.MODE === 'test') {
      registerConnectionTestHook({ drop: () => conn.drop(), resume: () => conn.resume() });
    }
    return () => conn.destroy();
  }, [doc, boardId]);

  // `objects` stays in lockstep with the doc: the observer is installed in
  // the layout phase, so by the time the board is on screen every committed
  // change (local or remote) has already produced a snapshot.
  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() => objectSnapshot(doc));
  useLayoutEffect(() => {
    const map = doc.getMap('objects');
    // (Re)sync on (re)mount for this doc — e.g. after switching boards the
    // previous doc's snapshots are stale.
    setObjects(objectSnapshot(doc));
    const handler = (): void => {
      setObjects(objectSnapshot(doc));
    };
    map.observeDeep(handler);
    return () => {
      map.unobserveDeep(handler);
    };
  }, [doc]);

  // Derived on `objects` so the notes array is stable across renders.
  const notes = useMemo(() => stickyNotes(objects), [objects]);
  return { doc, objects, notes, connectionState };
}
