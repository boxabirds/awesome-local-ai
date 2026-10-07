import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@/shared/config';
import { createSticky, deleteObject as deleteObj } from '@/shared/board-model';
import { isValidBoardId, newBoardId } from '@/shared/board-id';
import type { StickySnapshot } from '@/shared/board-model';
import type { ReactNode } from 'react';

/**
 * Parse the board id from the current URL pathname.
 * /b/<boardId> → board id string or null
 */
function parseBoardId(pathname: string): string | null {
  const match = /^\/b\/([A-Za-z0-9_-]{22})$/.exec(pathname);
  return match ? match[1] : null;
}

export function App(): ReactNode {
  // Simple client-side router: read board id from /b/:id, redirect / to new board
  const [pathname] = useState(() => window.location.pathname);
  const boardId = parseBoardId(pathname);

  // Redirect "/" (home) to a new board
  useEffect(() => {
    if (pathname === '/' && typeof window !== 'undefined') {
      const newId = newBoardId();
      history.replaceState(null, '', `/b/${newId}`);
    }
  }, [pathname]);

  const { doc, snap, connectionState } = useBoardDoc(boardId || undefined);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Disable editing when persistence is broken
  const canEdit =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'reconnecting' ||
    connectionState === 'confirmed';
  // Ref to hold camera for toolbar positioning
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  // Create sticky note at top-left world position and auto-select + edit it
  const handleCreateStickyAt = useCallback(
    (worldX: number, worldY: number) => {
      if (!canEdit) return;
      const id = createSticky(doc, { x: worldX, y: worldY }, DEFAULT_STICKY_COLOR);
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [doc, select, startEdit, canEdit],
  );

  // Double-click on empty board space → create note centred there
  const handleDblClickEmpty = useCallback(
    (worldX: number, worldY: number) => {
      handleCreateStickyAt(worldX, worldY);
    },
    [handleCreateStickyAt],
  );

  // Click on empty board space → clear selection
  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler for Enter / Delete / Backspace
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
        deleteObj(doc, selectedId);
        endEdit('unselected');
        return;
      }
    },
    [selectedId, editingId, startEdit, endEdit, doc],
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
          doc={doc}
          zoom={cameraRef.current.zoom}
          selected={selectedId === s.id}
          editing={editingId === s.id}
          onSelect={(id) => select(id)}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
        />
      ));
  }, [snap, doc, selectedId, editingId, select, startEdit, endEdit, cameraRef.current.zoom]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <Toolbar
        onCreateSticky={() => {
          const cam = cameraRef.current;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
          // Screen centre in world coords:
          //   screenToWorld(cam, {vw/2, vh/2}) = {vw/2/cam.zoom + cam.x, vh/2/cam.zoom + cam.y}
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
