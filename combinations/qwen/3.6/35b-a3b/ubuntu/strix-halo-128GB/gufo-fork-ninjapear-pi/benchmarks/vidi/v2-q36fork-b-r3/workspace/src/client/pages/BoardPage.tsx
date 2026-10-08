import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { checkBoard, CheckResponse } from '../api';
import { isValidBoardId } from '@shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';
import type { BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import { useBoardDoc } from '../board/useBoardDoc';
import { BoardViewport } from '../canvas/BoardViewport';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { getState } from '../sync/connectBoard';
import { useCamera } from '../canvas/useCamera';
import { screenToWorld, zoomPercent, canZoomIn, canZoomOut } from '../canvas/camera';
import { useSelection } from '../board/useSelection';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { useTransformGesture } from '../board/useTransformGesture';
import { MarqueeRect } from '../board/Marquee';
import { useMarquee } from '../board/Marquee';
import { useBoardKeys } from '../board/useBoardKeys';
import { useUndo } from '../board/useUndo';
import { createUndo } from '../board/undo';
import { createSticky, setStickyColor, deleteObjects } from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';
import type { Handle } from '@shared/geometry';

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

  // Ready — render the board with stories 1–7 UI + Share panel
  return <BoardContent boardId={pageState.boardId} />;
}

/** Board content — stories 1–7 UI wrapped with Share button */
function BoardContent({ boardId }: { boardId: string }) {
  const viewportSize = useRef({ width: 1280, height: 800 }).current;
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, panMove, wheel, zoomStep, reset: camReset } = cameraState;

  const board = useBoardDoc(boardId);
  const selection = useSelection(board.doc, board.snapshot);
  const globalConnState = getState();
  const canEdit = globalConnState !== 'load_failed';

  // ─── Story 8: Undo controller ───────────────────────────────────
  const undoControllerRef = useRef<ReturnType<typeof createUndo> | null>(null);

  // Memoize the controller so it survives re-renders but is recreated on board change
  const undoController = useMemo(() => {
    if (!board.doc) return null;
    return createUndo(board.doc);
  }, [board.doc]); // recreated when board doc changes (e.g. different board)

  // Clean up controller on unmount or board change
  useEffect(() => {
    const ctrl = undoController;
    return () => ctrl?.destroy();
  }, [undoController]);

// Story 8: boundary callback for gestures and editing
  const boundary = useCallback(() => {
    undoController?.boundary();
  }, [undoController]);

  // Story 7: keyboard commands + undo shortcuts
  useBoardKeys({
    doc: board.doc,
    selection,
    snapshot: board.snapshot,
    canEdit,
    undoController,
    onBoundary: boundary,
  });

  // Story 8: undo state binding
  const { canUndo, canRedo, undo, redo } = useUndo(undoController, canEdit);

  // Story 7: transform gesture (move / resize) with undo boundaries
  const gesture = useTransformGesture({
    doc: board.doc,
    camera,
    selection,
    snapshot: board.snapshot,
    canEdit,
    onGestureStart: undefined,
    onGestureEnd: undefined,
    onBoundary: boundary,
  });

  // Story 7: marquee
  const marquee = useMarquee({
    camera,
    snapshot: board.snapshot,
    onSelect: (ids) => {
      if (ids.length > 0) {
        selection.setMany(ids, true); // additive
      } else {
        selection.clear();
      }
    },
  });

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
      // Boundary before creating a new sticky note (one step)
      boundary();
      const id = createSticky(board.doc, worldPoint);
      selection.click(id);
      selection.startEdit(id);
      return id;
    },
    [board.doc, camera, selection, viewportSize, canEdit, boundary],
  );

  const handleToolbarCreate = useCallback(() => {
    handleCreateSticky();
  }, [handleCreateSticky]);

  const handleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        selection.toggle(id);
      } else {
        selection.click(id);
      }
    },
    [selection],
  );

  const handleStartEdit = useCallback((id: string) => selection.startEdit(id), [selection]);

  const handleEndEdit = useCallback(
    (_next: 'selected' | 'unselected') => {
      boundary();
      selection.endEdit(_next);
    },
    [boundary, selection],
  );

  const handleDeleteSelection = useCallback(() => {
    boundary();
    const ids = [...selection.ids];
    deleteObjects(board.doc, ids);
    selection.clear();
  }, [board.doc, selection, boundary]);

  const handleSetStickyColor = useCallback(
    (id: string, color: string) => {
      boundary();
      setStickyColor(board.doc, id, color);
    },
    [board.doc, boundary],
  );

  // Track pointer move for drag/marquee in BoardViewport
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Marquee movement
      if (marquee.rect !== null || marquee) {
        // handled by pointer events on viewport
      }
    },
    [marquee],
  );

  const spacingPx = 24 * camera.zoom;
  const bgPosX = (-camera.x * camera.zoom) % spacingPx;
  const bgPosY = (-camera.y * camera.zoom) % spacingPx;

  return (
    <>
      {/* Share button top-right */}
      <SharePanel boardId={boardId} />

      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={!canEdit}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
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
        onClearSelection={() => selection.clear()}
        onEmptyPointerDown={(e) => {
          // Shift+drag → marquee
          if (e.shiftKey) {
            marquee.begin({ x: e.clientX, y: e.clientY });
          }
        }}
        onEmptyPointerUp={() => {
          marquee.end();
        }}
      >
        <MarqueeRect rect={marquee.rect ?? null} camera={camera} />
        {board.snapshot.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={board.doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onSelect={(id: string, shiftKey: boolean) => handleSelect(id, shiftKey)}
            onStartEdit={handleStartEdit}
            onEndEdit={handleEndEdit}
            onUndoBoundary={boundary}
            onUndo={() => { undo(); return true; }}
            onRedo={() => { redo(); return true; }}
            onObjectPointerDown={(e: PointerEvent, id: string) => {
              gesture.onObjectPointerDown(e, id);
            }}
            onHandlePointerDown={(e: PointerEvent, h: Handle) => {
              gesture.onHandlePointerDown(e, h);
            }}
            onColorChange={handleSetStickyColor}
          />
        ))}
        {selection.ids.size > 0 && (
          <SelectionOverlay
            ids={selection.ids}
            snapshot={board.snapshot}
            camera={camera}
            onHandlePointerDown={(e, h) => gesture.onHandlePointerDown(e, h)}
          />
        )}
      </BoardViewport>
      {/* Selection bar positioned above the viewport */}
      {selection.ids.size >= 1 && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
          }}
        >
<SelectionBar
            ids={selection.ids}
            snapshot={board.snapshot}
            doc={board.doc}
            onDelete={handleDeleteSelection}
            onBoundary={boundary}
          />
        </div>
      )}
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
