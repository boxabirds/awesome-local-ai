/**
 * Board root — shared Y.Doc + WebSocket connection for a board id.
 * Story 5 — share a board with others using a link.
 * Story 8 — undo/redo integration.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';
import { snapshot, initDoc } from '@/shared/board-model';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@/shared/config';
import { createSticky, deleteObject as deleteObj } from '@/shared/board-model';
import type { StickySnapshot, ObjectSnapshot } from '@/shared/board-model';
import { BoardViewport } from '../canvas/BoardViewport';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useSelection } from './useSelection';
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import type { Handle } from '@/client/objects/registry';

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
  const snaps = snap as readonly ObjectSnapshot[];
  const { ids, editingId, click, toggle, setMany, clear: clearSelection, startEdit, endEdit } = useSelection(snaps);
  const selectedId = ids.size === 1 ? [...ids][0] : null;

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

  // Create per-board UndoController
  const undoControllerRef = useRef<ReturnType<typeof createUndo> | null>(null);
  const prevBoardIdRef = useRef<string | undefined>(boardId);

  useEffect(() => {
    if (boardId !== prevBoardIdRef.current && undoControllerRef.current) {
      undoControllerRef.current.destroy();
      undoControllerRef.current = null;
    }
    prevBoardIdRef.current = boardId;

    if (!undoControllerRef.current && docRef) {
      const objectsMap = docRef.getMap('objects');
      undoControllerRef.current = createUndo(docRef);
    }
  }, [docRef, boardId]);

  const undoState = useUndo(undoControllerRef.current, canEdit);

  const handleCreateStickyAt = useCallback(
    (worldX: number, worldY: number) => {
      if (!canEdit) return;
      undoControllerRef.current?.boundary();
      const id = createSticky(docRef!, { x: worldX, y: worldY }, DEFAULT_STICKY_COLOR);
      if (id) {
        click(id);
        startEdit(id);
      }
    },
    [click, startEdit, canEdit],
  );

  const handleDblClickEmpty = useCallback(
    (worldX: number, worldY: number) => {
      handleCreateStickyAt(worldX, worldY);
    },
    [handleCreateStickyAt],
  );

  const handleClickEmpty = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleWindowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setMany(snaps.map(s => s.id), false);
        return;
      }

      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      // Delete / Backspace → delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.size > 0 && canEdit) {
        e.preventDefault();
        for (const id of ids) {
          deleteObj(docRef!, id);
        }
        clearSelection();
        return;
      }

      // Undo shortcut
      if (undoControllerRef.current && ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey)) {
        if (!canEdit) return;
        e.preventDefault();
        if (undoControllerRef.current.canUndo()) {
          undoControllerRef.current.undo();
        }
        return;
      }

      // Redo shortcuts
      if (undoControllerRef.current && (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')
      )) {
        if (!canEdit) return;
        e.preventDefault();
        if (undoControllerRef.current.canRedo()) {
          undoControllerRef.current.redo();
        }
        return;
      }
    },
    [ids, selectedId, startEdit, endEdit, clearSelection, click, setMany, canEdit, snaps],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [handleWindowKeyDown]);

  // Render note components sorted by z/id
  const notes = useMemo(() => {
    const stickySnaps = snaps.filter((s): s is StickySnapshot & { type: 'sticky' } => s.type === 'sticky');
    return stickySnaps.map((s) => {
      const isSelected = ids.has(s.id);
      const isSelectedOnly = isSelected && ids.size === 1;
      return (
        <StickyNote
          key={s.id}
          note={s}
          doc={docRef!}
          zoom={cameraRef.current.zoom}
          selected={isSelected}
          editing={editingId === s.id}
          isSelectedOnly={isSelectedOnly}
          onSelect={(id) => click(id)}
          onStartEdit={startEdit}
          onEndEdit={() => endEdit()}
          onObjectPointerDown={(_e, _id) => { /* handled via gesture system in story 7 */ }}
          undoController={undoControllerRef.current}
        />
      );
    });
  }, [snaps, ids, editingId, click, startEdit, endEdit, cameraRef.current.zoom]);

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
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        undo={undoState.undo}
        redo={undoState.redo}
      />
      <BoardViewport
        onCameraChange={(cam) => {
          cameraRef.current = cam;
        }}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        selectedIds={ids}
        onSelect={(idsList) => setMany(idsList, true)}
        isEditing={editingId !== null}
        snapshot={snaps}
      >
        {notes}
      </BoardViewport>
    </>
  );
}
