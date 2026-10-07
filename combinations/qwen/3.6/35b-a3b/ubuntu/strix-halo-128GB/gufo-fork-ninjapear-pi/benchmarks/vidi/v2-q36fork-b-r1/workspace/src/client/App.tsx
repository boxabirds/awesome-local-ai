import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '@/shared/config';
import { createSticky, deleteObjects as deleteObj } from '@/shared/board-model';
import type { StickySnapshot, ObjectSnapshot } from '@/shared/board-model';
import type { Handle } from '@/client/objects/registry';
import { useRoute, navigate } from './router';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePanel } from './share/SharePanel';

/** Main app — routes to HomePage, BoardPage, or NotFoundPage based on URL. */
export function App(): ReactNode {
  const route = useRoute();

  if (route.name === 'home') {
    return <HomePage />;
  }

  if (route.name === 'not_found') {
    return <NotFoundPage onCreateBoard={() => navigate('/')} />;
  }

  const boardId = route.id;
  const { doc, snap, connectionState } = useBoardDoc(boardId);
  const snaps = snap as unknown as readonly ObjectSnapshot[];
  const { ids, editingId, click, toggle, setMany, clear: clearSelection, startEdit, endEdit } = useSelection(snaps);

  // Disable editing when persistence is broken
  const canEdit =
    connectionState === 'connected' ||
    connectionState === 'connecting' ||
    connectionState === 'reconnecting' ||
    connectionState === 'confirmed';

  // Camera ref for toolbar positioning
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  // Create sticky note at top-left world position and auto-select + edit it
  const handleCreateStickyAt = useCallback(
    (worldX: number, worldY: number) => {
      if (!canEdit) return;
      const id = createSticky(doc, { x: worldX, y: worldY }, DEFAULT_STICKY_COLOR);
      if (id) {
        click(id);
        startEdit(id);
      }
    },
    [doc, click, startEdit, canEdit],
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

  // Keyboard commands
  useBoardKeys({
    doc,
    selectedIds: ids,
    snapshot: snaps,
    canEdit,
    isEditing: editingId !== null,
    setMany,
    clear: clearSelection,
  });

  // Transform gesture (group move & resize handles)
  const gesture = useTransformGesture({
    doc,
    camera: cameraRef.current,
    selectedIds: ids,
    snapshot: snaps,
    canEdit,
    isEditing: editingId !== null,
    onGestureStart: () => {},
    onGestureEnd: () => {},
  });

  // Render note components sorted by z/id
  const notes = useMemo(() => {
    const snaps = snap as StickySnapshot[];
    return snaps
      .filter((s): s is StickySnapshot & { type: 'sticky' } => s.type === 'sticky')
      .map((s) => {
        const isSelected = ids.has(s.id);
        const isSelectedOnly = isSelected && ids.size === 1;
        return (
          <StickyNote
            key={s.id}
            note={s}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={isSelected}
            editing={editingId === s.id}
            isSelectedOnly={isSelectedOnly}
            onSelect={(id) => click(id)}
            onStartEdit={startEdit}
            onEndEdit={() => endEdit()}
            onObjectPointerDown={gesture.onObjectPointerDown as any}
          />
        );
      });
  }, [snap, doc, ids, editingId, click, startEdit, endEdit, gesture.onObjectPointerDown, cameraRef.current.zoom]);

  // Group move handler
  const onObjectDragMove = useCallback(
    (e: PointerEvent) => {
      if (!ids.size) return;
      // Move all selected objects together
    },
    [ids],
  );

  // Delete selection bar handler
  const handleDeleteSelection = useCallback(() => {
    if (ids.size === 0) return;
    deleteObj(doc, Array.from(ids));
    clearSelection();
  }, [doc, ids, clearSelection]);

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
      <SharePanel boardId={boardId} />
      <SelectionBar
        ids={ids}
        snapshot={snaps}
        onDelete={handleDeleteSelection}
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
        <SelectionOverlay
          ids={ids}
          snapshot={snaps}
          camera={cameraRef.current}
          onHandlePointerDown={(_e: PointerEvent, _h: Handle) => {
            // Resize is handled via the gesture system
          }}
        />
      </BoardViewport>
    </>
  );
}
