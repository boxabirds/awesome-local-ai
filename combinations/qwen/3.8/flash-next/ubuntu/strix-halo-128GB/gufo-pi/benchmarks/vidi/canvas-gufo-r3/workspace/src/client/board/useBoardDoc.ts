import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, snapshotAll, StickySnapshot, ObjectSnapshot } from '@shared/board-model';
import { connectBoard, type ConnectionState } from '@client/sync/connectBoard';

export interface BoardDoc {
  doc: Y.Doc;
  notes: readonly StickySnapshot[];
  allObjects: readonly ObjectSnapshot[];
  connectionState: ConnectionState;
}

/**
 * Owns one Y.Doc and, when a `boardId` is supplied, a live network provider.
 * Recomputes immutable snapshots on objects.observeDeep — which fires for both
 * local edits and remote updates the provider applies, so other people's changes
 * re-render this board too.
 *
 * Selection and editing state are deliberately NOT held here: they are local to
 * each client and never written to the doc.
 */
export function useBoardDoc(boardId?: string): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (!docRef.current) {
    const doc = new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    boardId ? 'connecting' : 'connected',
  );

  // Attach / detach the network provider when the board changes.
  useEffect(() => {
    if (!boardId) {
      setConnectionState('connected');
      return;
    }
    const conn = connectBoard(doc, boardId, setConnectionState);
    return () => conn.destroy();
  }, [doc, boardId]);

  // A monotonically increasing version bumped on any deep change to the objects
  // map. Snapshots are derived with useMemo keyed on this version, which is the
  // reliable way to re-render on both local and remote edits.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = () => setVersion((v) => v + 1);
    objects.observeDeep(observer);
    // Recompute once on mount so we pick up changes that landed between render and subscribe.
    setVersion((v) => v + 1);
    return () => objects.unobserveDeep(observer);
  }, [objects]);

  const notes = useMemo(() => snapshot(doc), [doc, version]);
  const allObjects = useMemo(() => snapshotAll(doc), [doc, version]);

  return useMemo(
    () => ({ doc, notes, allObjects, connectionState }),
    [doc, notes, allObjects, connectionState],
  );
}
