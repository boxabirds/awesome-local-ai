import * as React from 'react';
import * as Y from 'yjs';
import { snapshot, initDoc } from '../../shared/board-model';
import { connectBoard, ConnectionState } from '../sync/connectBoard';
import { ConnectionStatus } from '../sync/ConnectionStatus';

let _doc: Y.Doc | null = null;

export function useBoardDoc(boardId: string): {
  doc: Y.Doc;
  snapshots: readonly import('../../shared/board-model').StickySnapshot[];
  connectionState: ConnectionState;
  ConnectionStatus: typeof ConnectionStatus;
} {
  // Singleton doc (per page load) — in future stories this may be per-board
  if (!_doc) {
    _doc = new Y.Doc();
    initDoc(_doc);
  }

  const [snapshots, setSnapshots] = React.useState(() => snapshot(_doc!));
  const [connectionState, setConnectionState] = React.useState<ConnectionState>('connecting');

  // Track current boardId to destroy provider on change
  const prevBoardId = React.useRef<string>(boardId);

  React.useEffect(() => {
    const objects = _doc!.getMap('objects');
    const handler = () => {
      setSnapshots(snapshot(_doc!));
    };
    objects.observeDeep(handler);
    return () => {
      objects.unobserveDeep(handler);
    };
  }, []);

  // Connect/reconnect when boardId changes
  React.useEffect(() => {
    if (boardId === prevBoardId.current) return;
    prevBoardId.current = boardId;

    const provider = connectBoard(_doc!, boardId, (state) => {
      setConnectionState(state);
    });

    return () => {
      provider.destroy();
    };
  }, [boardId]);

  return {
    doc: _doc!,
    snapshots,
    connectionState,
    ConnectionStatus,
  };
}
