import { useRef, useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type AnySnapshot } from '../../shared/board-model';
import { connectBoard, type ConnectionState } from '../sync/connectBoard';

export function useBoardDoc(boardId: string): {
  doc: Y.Doc;
  notes: readonly AnySnapshot[];
  connectionState: ConnectionState;
} {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  // Attach/detach the sync provider when boardId changes
  useEffect(() => {
    if (!boardId) return;
    const connection = connectBoard(doc, boardId, (s) => {
      setConnectionState(s);
    });
    return () => {
      connection.destroy();
    };
  }, [doc, boardId]);

  const snapshotCacheRef = useRef<{ key: string; value: readonly AnySnapshot[] }>({ key: '', value: [] });

  const subscribe = useCallback(
    (callback: () => void) => {
      const objects = doc.getMap('objects');
      objects.observeDeep(callback);
      return () => objects.unobserveDeep(callback);
    },
    [doc],
  );

  const getSnapshot = useCallback(() => {
    const snap = snapshot(doc);
    // Create a stable key from the snapshot content (text, colour and text
    // size/width-mode included: text-only edits must invalidate the cache,
    // story 8; size changes must too, story 9)
    const key = snap
      .map((o) => {
        let extras = '';
        let text = '';
        if (o.type === 'sticky') {
          extras = o.color;
          text = o.text;
        } else if (o.type === 'text') {
          extras = `${o.size}:${o.widthMode}`;
          text = o.text;
        } else if (o.type === 'shape') {
          extras = `${o.kind}:${o.fill}:${o.stroke}`;
          text = o.label;
        } else if (o.type === 'stroke') {
          extras = `${o.color}:${o.thickness}`;
        } else if (o.type === 'connector') {
          extras = `${o.from.kind}:${o.to.kind}`;
        }
        return `${o.id}:${o.x}:${o.y}:${o.z}:${o.width ?? ''}:${o.height ?? ''}:${extras}:${text}`;
      })
      .join('\0');
    if (key !== snapshotCacheRef.current.key) {
      snapshotCacheRef.current = { key, value: snap };
    }
    return snapshotCacheRef.current.value;
  }, [doc]);

  const notes = useSyncExternalStore(subscribe, getSnapshot);

  return { doc, notes, connectionState };
}
