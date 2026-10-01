import { useRef, useEffect, useState, useCallback } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '../canvas/camera';
import { installTestHooks } from '../canvas/testHooks';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { createSticky, deleteObject } from '../../shared/board-model';
import { SharePanel } from '../share/SharePanel';

export function BoardUI({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 });

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCamera } =
    useCamera(viewportSize);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const canEdit = connectionState !== 'load_failed';

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Test hooks (only active in test mode)
  useEffect(() => {
    installTestHooks(setCamera);
  }, [setCamera]);

  // Expose connection state for e2e tests
  useEffect(() => {
    (window as any).__vidi6 = (window as any).__vidi6 || {};
    (window as any).__vidi6.connectionState = connectionState;
  }, [connectionState]);

  // Create a sticky note at a world point
  const createStickyAt = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      const id = createSticky(doc, worldPoint);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit, canEdit],
  );

  // Handle double-click on empty board space
  const handleDoubleClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      const worldPoint = screenToWorld(camera, screenPoint);
      createStickyAt(worldPoint);
    },
    [camera, createStickyAt],
  );

  // Handle toolbar button click - create at viewport centre
  const handleToolbarCreate = useCallback(() => {
    const centre = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const worldPoint = screenToWorld(camera, centre);
    createStickyAt(worldPoint);
  }, [camera, viewportSize, createStickyAt]);

  // Handle empty space click - clear selection
  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  // Clear selection/editing if the selected note was deleted by someone else
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) {
      select(null);
    }
    if (editingId && !notes.some((n) => n.id === editingId)) {
      endEdit('unselected');
    }
  }, [notes, selectedId, editingId, select, endEdit]);

  // Keyboard handler for Enter and Delete/Backspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (!canEdit) return;
      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, editingId, doc, select, startEdit, canEdit]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        beginPan={beginPan}
        panMove={panMove}
        endPan={endPan}
        wheel={wheel}
        zoomStep={zoomStep}
        reset={reset}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onPointerDownEmpty={handleEmptyClick}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            editable={canEdit}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={!canEdit} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated && notes.length === 0} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
