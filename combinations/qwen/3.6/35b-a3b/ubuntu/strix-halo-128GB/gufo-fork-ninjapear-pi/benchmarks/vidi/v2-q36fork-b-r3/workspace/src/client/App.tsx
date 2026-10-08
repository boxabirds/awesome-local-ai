import React, { useCallback } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, setStickyColor } from '@shared/board-model';
import { screenToWorld } from './canvas/camera';
import type { StickySnapshot } from '@shared/board-model';

// Expose camera on window for E2E tests
declare global {
  interface Window {
    __getCamera?: () => ReturnType<typeof useCamera>['camera'] | null;
    __getStickyNotes?: () => readonly StickySnapshot[];
  }
}

export function App() {
  const [viewportSize] = React.useState({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, panMove, wheel, zoomStep, reset: camReset } = cameraState;

  const board = useBoardDoc();
  const selection = useSelection();

  // Expose camera & notes for e2e inspection
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__getCamera = () => camera;
    window.__getStickyNotes = () => board.snapshot;
  }

  // ── Create sticky note ──────────────────────────────────────────────
  const handleCreateSticky = useCallback(
    (worldPoint?: { x: number; y: number }) => {
      if (!worldPoint) {
        worldPoint = screenToWorld(camera, {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2,
        });
      }
      const id = createSticky(board.doc, worldPoint);
      selection.select(id);
      selection.startEdit(id);
      return id;
    },
    [board.doc, camera, selection, viewportSize],
  );

  const handleToolbarCreate = useCallback(() => {
    handleCreateSticky();
  }, [handleCreateSticky]);

  // ── Keyboard handler (window level) ─────────────────────────────────
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Enter') {
        if (selection.selectedId && !selection.editingId) {
          e.preventDefault();
          selection.startEdit(selection.selectedId);
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.selectedId && !selection.editingId) {
          e.preventDefault();
          const ok = deleteObject(board.doc, selection.selectedId!);
          if (ok) {
            selection.select(null);
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [board.doc, selection]);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (id: string) => selection.select(id),
    [selection],
  );

  const handleStartEdit = useCallback(
    (id: string) => selection.startEdit(id),
    [selection],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => selection.endEdit(next),
    [selection],
  );

  const handleClearSelection = useCallback(
    () => selection.select(null),
    [selection],
  );

  const selectedNote = board.snapshot.find((s) => s.id === selection.selectedId);
  const needsToolbar =
    selection.selectedId !== null &&
    !selection.editingId &&
    selectedNote !== undefined;

  // Compute toolbar position in screen space
  let toolbarScreenStyle: React.CSSProperties | undefined;
  if (needsToolbar && selectedNote) {
    const screenPos = {
      x: (selectedNote.x + camera.x) * camera.zoom,
      y: (selectedNote.y + camera.y) * camera.zoom,
    };
    toolbarScreenStyle = {
      position: 'absolute',
      left: `${screenPos.x}px`,
      top: `${Math.max(screenPos.y - 40, 0)}px`,
      transform: 'translateX(-50%)',
    };
  }

  // ── Dot grid styles ─────────────────────────────────────────────────
  const spacingPx = 24 * camera.zoom;
  const bgPosX = (-camera.x * camera.zoom) % spacingPx;
  const bgPosY = (-camera.y * camera.zoom) % spacingPx;

  return (
    <>
      <Toolbar onCreateSticky={handleToolbarCreate} />
      <BoardViewport
        camera={camera}
        onPanMove={panMove}
        onWheel={(dx, dy, ctrlOrMeta, point) =>
          wheel({ deltaX: dx, deltaY: dy, ctrlOrMeta, point })
        }
        onEndPan={cameraState.endPan}
        onKeyDownZoom={(action) => {
          if (action === 'zoomIn') zoomStep('in');
          else if (action === 'zoomOut') zoomStep('out');
          else camReset();
        }}
        style={{
          backgroundImage: `radial-gradient(circle, #999 1px, transparent 1px)`,
          backgroundSize: `${spacingPx}px ${spacingPx}px`,
          backgroundPosition: `${bgPosX}px ${bgPosY}px`,
        }}
        onCreateSticky={handleCreateSticky}
        onClearSelection={handleClearSelection}
      >
        {/* Render sticky notes */}
        {board.snapshot.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={board.doc}
            zoom={camera.zoom}
            selected={note.id === selection.selectedId}
            editing={note.id === selection.editingId}
            onSelect={handleSelect}
            onStartEdit={handleStartEdit}
            onEndEdit={handleEndEdit}
          />
        ))}
        {/* Note toolbar — positioned in screen space above selected note */}
        {needsToolbar && selectedNote && (
          <div style={toolbarScreenStyle}>
            <NoteToolbar
              color={selectedNote.color}
              onColor={(color) => {
                setStickyColor(board.doc, selectedNote.id, color);
              }}
              onDelete={() => {
                deleteObject(board.doc, selectedNote.id);
                selection.select(null);
              }}
            />
          </div>
        )}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={camReset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}
