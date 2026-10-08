import React, { useState, useEffect, useCallback, useRef } from 'react';
import { checkBoard, CheckResponse } from '../api';
import { isValidBoardId } from '@shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';
import type { BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import { useBoardDoc } from '../board/useBoardDoc';
import { BoardViewport } from '../canvas/BoardViewport';
import { Toolbar } from '../board/Toolbar';
import { NoteToolbar } from '../objects/NoteToolbar';
import { StickyNote } from '../objects/StickyNote';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { getState } from '../sync/connectBoard';
import { useCamera } from '../canvas/useCamera';
import { screenToWorld, zoomPercent, canZoomIn, canZoomOut } from '../canvas/camera';
import { useSelection } from '../board/useSelection';
import { createSticky, deleteObject, setStickyColor } from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';

// Re-export camera and notes for e2e
declare global {
  interface Window {
    __getCamera?: () => ReturnType<typeof useCamera>['camera'] | null;
    __getStickyNotes?: () => readonly StickySnapshot[];
  }
}

export function BoardPage(props: { id: string }) {
  const [pageState, setPageState] = useState<BoardPageState>({ kind: 'checking' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);
  const viewportSize = useRef({ width: 1280, height: 800 }).current;
  const retryCountRef = useRef(0);

  // Initial existence check on mount
  const performCheck = useCallback(async (id: string) => {
    if (!isValidBoardId(id)) {
      setPageState({ kind: 'not_found' });
      return false;
    }

    setPageState((prev) => prev.kind !== 'unreachable' ? { kind: 'checking' } : prev);
    const result = await checkBoard(id);

    if (abortRef.current) return false;

    switch (result.kind) {
      case 'exists':
        setPageState({ kind: 'ready', boardId: id });
        return true;

      case 'not_found':
        setPageState({ kind: 'not_found' });
        return false;

      case 'unreachable': {
        retryCountRef.current += 1;
        const delay = Math.min(
          BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, retryCountRef.current - 1),
          RECONNECT_MAX_BACKOFF_MS,
        );
        setPageState({ kind: 'unreachable', attempt: retryCountRef.current, nextRetryMs: delay });
        return false;
      }
    }
  }, []);

  // Check once on mount
  useEffect(() => {
    abortRef.current = false;
    performCheck(props.id);
  }, [props.id]);

  // Retry timer for unreachable state
  useEffect(() => {
    if (pageState.kind !== 'unreachable') return;

    timerRef.current = setTimeout(async () => {
      if (abortRef.current) return;
      await performCheck(props.id);
    }, pageState.nextRetryMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pageState.kind === 'unreachable' ? pageState.nextRetryMs : -1, props.id]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ─── Render based on page state ────────────────────────────────

  if (pageState.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (pageState.kind === 'unreachable') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <h2>Couldn't reach vidi6. Retrying…</h2>
        <p style={{ marginTop: 8, color: '#666' }}>Attempt {pageState.attempt}</p>
      </div>
    );
  }

  if (pageState.kind === 'checking') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <h2>Opening board…</h2>
      </div>
    );
  }

  // Ready — render the board with stories 1–4 UI + Share panel
  return <BoardContent boardId={pageState.boardId} />;
}

/** Board content — stories 1–4 UI wrapped with Share button */
function BoardContent({ boardId }: { boardId: string }) {
  const viewportSize = useRef({ width: 1280, height: 800 }).current;
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, panMove, wheel, zoomStep, reset: camReset } = cameraState;

  const board = useBoardDoc(boardId);
  const selection = useSelection(board.doc);
  const globalConnState = getState();
  const canEdit = globalConnState !== 'load_failed';

  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__getCamera = () => camera;
    window.__getStickyNotes = () => board.snapshot;
  }

  const handleCreateSticky = useCallback(
    (worldPoint?: { x: number; y: number }) => {
      if (!canEdit) return undefined;
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
    [board.doc, camera, selection, viewportSize, canEdit],
  );

  const handleToolbarCreate = useCallback(() => {
    handleCreateSticky();
  }, [handleCreateSticky]);

  useEffect(() => {
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
        if (!canEdit) return;
        if (selection.selectedId && !selection.editingId) {
          e.preventDefault();
          const ok = deleteObject(board.doc, selection.selectedId!);
          if (ok) selection.select(null);
        }
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [board.doc, selection]);

  const handleSelect = useCallback((id: string) => selection.select(id), [selection]);
  const handleStartEdit = useCallback((id: string) => selection.startEdit(id), [selection]);
  const handleEndEdit = useCallback((next: 'selected' | 'unselected') => selection.endEdit(next), [selection]);
  const handleClearSelection = useCallback(() => selection.select(null), [selection]);

  const selectedNote = board.snapshot.find((s) => s.id === selection.selectedId);
  const needsToolbar = selection.selectedId !== null && !selection.editingId && selectedNote !== undefined;

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

  const spacingPx = 24 * camera.zoom;
  const bgPosX = (-camera.x * camera.zoom) % spacingPx;
  const bgPosY = (-camera.y * camera.zoom) % spacingPx;

  return (
    <>
      {/* Share button top-right */}
      <SharePanel boardId={boardId} />
      
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={!canEdit} />
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
        {needsToolbar && selectedNote && (
          <div style={toolbarScreenStyle}>
            <NoteToolbar
              color={selectedNote.color}
              onColor={(color) => setStickyColor(board.doc, selectedNote.id, color)}
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
      <ConnectionStatus state={getState()} />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}
