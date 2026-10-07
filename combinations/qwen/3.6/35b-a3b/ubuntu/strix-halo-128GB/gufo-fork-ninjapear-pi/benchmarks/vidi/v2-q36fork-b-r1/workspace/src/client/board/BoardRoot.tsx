/**
 * Board root — shared Y.Doc + WebSocket connection for a board id.
 * Story 5 — share a board with others using a link.
 *
 * This is a simplified version that reuses useBoardDoc from the main app.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';
import { snapshot, initDoc } from '@/shared/board-model';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@/shared/config';
import { createSticky, deleteObject as deleteObj } from '@/shared/board-model';
import type { StickySnapshot } from '@/shared/board-model';
import { BoardViewport } from '../canvas/BoardViewport';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useSelection } from './useSelection';

let docRef: Y.Doc | null = null;

interface BoardRootProps {
  boardId: string;
}

export function BoardRoot(props: BoardRootProps): ReactNode {
  const boardId = props.boardId;
  const [snap, setSnap] = useState(() => Object.freeze(snapshot(new Y.Doc())));
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const connectRef = useRef<{ destroy(): void } | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Lazy-create shared doc singleton per board
  if (!docRef) {
    docRef = new Y.Doc();
    initDoc(docRef);
    setSnap(Object.freeze(snapshot(docRef)));
  }

  // Subscribe to deep changes on the objects map
  useEffect(() => {
    const objectsMap = docRef!.getMap('objects');
    const handler = () => {
      setSnap(Object.freeze(snapshot(docRef!)));
    };
    objectsMap.observeDeep(handler);
    return () => {
      objectsMap.unobserveDeep(handler);
    };
  }, []);

  // Attach WebSocket provider when boardId is given
  useEffect(() => {
    connectRef.current = connectBoard(docRef!, boardId, (state) => {
      setConnectionState(state);
    });

    return () => {
      connectRef.current?.destroy();
      connectRef.current = null;
    };
  }, [boardId]);

  // Disable editing when persistence is broken
  const canEdit =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'reconnecting' ||
    connectionState === 'confirmed';

  const handleCreateStickyAt = useCallback(
    (worldX: number, worldY: number) => {
      if (!canEdit) return;
      const id = createSticky(docRef!, { x: worldX, y: worldY }, DEFAULT_STICKY_COLOR);
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [select, startEdit, canEdit],
  );

  const handleDblClickEmpty = useCallback(
    (worldX: number, worldY: number) => {
      handleCreateStickyAt(worldX, worldY);
    },
    [handleCreateStickyAt],
  );

  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  const handleWindowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;

      if (e.key === 'Enter' && selectedId && !editingId && canEdit) {
        e.preventDefault();
        startEdit(selectedId);
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId && canEdit) {
        e.preventDefault();
        deleteObj(docRef!, selectedId);
        endEdit('unselected');
        return;
      }
    },
    [selectedId, editingId, startEdit, endEdit, select],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [handleWindowKeyDown]);

  // Render note components sorted by z/id
  const notes = useMemo(() => {
    const snaps = snap as StickySnapshot[];
    return snaps
      .filter((s): s is StickySnapshot & { type: 'sticky' } => s.type === 'sticky')
      .map((s) => (
        <StickyNote
          key={s.id}
          note={s}
          doc={docRef!}
          zoom={cameraRef.current.zoom}
          selected={selectedId === s.id}
          editing={editingId === s.id}
          onSelect={(id) => select(id)}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
        />
      ));
  }, [snap, selectedId, editingId, select, startEdit, endEdit, cameraRef.current.zoom]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <Toolbar
        onCreateSticky={() => {
          const cam = cameraRef.current;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
          const wpX = vw / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2;
          const wpY = vh / cam.zoom + cam.y - STICKY_SIZE_WORLD / 2;
          handleCreateStickyAt(wpX, wpY);
        }}
      />
      <BoardViewport
        onCameraChange={(cam) => {
          cameraRef.current = cam;
        }}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
      >
        {notes}
      </BoardViewport>
    </>
  );
}
