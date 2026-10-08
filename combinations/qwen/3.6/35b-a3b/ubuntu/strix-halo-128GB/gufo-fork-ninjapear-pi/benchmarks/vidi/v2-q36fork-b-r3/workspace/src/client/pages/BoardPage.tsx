import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as Y from 'yjs';
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
import { TextObject } from '../objects/TextObject';
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
import { createText, setTextSize } from '@shared/objects/text';
import { useTool } from '../board/useTool';
import type { StickySnapshot } from '@shared/board-model';
import type { TextSnapshot } from '@shared/objects/text';
import type { Handle } from '@shared/geometry';
import { objectBounds } from '@shared/board-model';
import { getObjectType } from '../objects/registry';

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

  // Ready — render the board with stories 1–9 UI + Share panel
  return <BoardContent boardId={pageState.boardId} />;
}

/** Board content — stories 1–9 UI */
function BoardContent({ boardId }: { boardId: string }) {
  const viewportSize = useRef({ width: 1280, height: 800 }).current;
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, panMove, wheel, zoomStep, reset: camReset } = cameraState;

  const board = useBoardDoc(boardId);
  const selection = useSelection(board.doc, board.snapshot);
  const globalConnState = getState();
  const canEdit = globalConnState !== 'load_failed';

  // Story 9: tool mode
  const { tool, setTool } = useTool(canEdit);

  // ─── Story 8: Undo controller ─────────────────────────────────--

  // Boundary callback for gestures and editing
  const boundaryRef = useRef<() => void>(() => {});

  // ─── Handlers (defined before use) ───────────────────────────────

  const handleCreateSticky = useCallback(
    (worldPoint?: { x: number; y: number }) => {
      if (!canEdit) return undefined;
      if (!worldPoint) {
        worldPoint = screenToWorld(camera, {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2,
        });
      }
      boundaryRef.current();
      const id = createSticky(board.doc, worldPoint);
      if (id) {
        selection.click(id);
        selection.startEdit(id);
      }
      return id;
    },
    [board.doc, camera, selection, viewportSize, canEdit],
  );

  const handleToolbarCreate = useCallback(() => {
    handleCreateSticky();
  }, [handleCreateSticky]);
  const undoControllerRef = useRef<ReturnType<typeof createUndo> | null>(null);

  const undoController = useMemo(() => {
    if (!board.doc) return null;
    return createUndo(board.doc);
  }, [board.doc]);

  useEffect(() => {
    const ctrl = undoController;
    return () => ctrl?.destroy();
  }, [undoController]);

  // Story 8: boundary callback for gestures and editing
  const boundary = useCallback(() => {
    undoController?.boundary();
  }, [undoController]);

  // Set the ref early so handlers can use it before it's stable
  useEffect(() => {
    boundaryRef.current = boundary;
  }, [boundary]);

  useBoardKeys({
    doc: board.doc,
    selection,
    snapshot: board.snapshot,
    canEdit,
    undoController,
    onBoundary: boundaryRef.current,
    activeTool: tool,
    setActiveTool: setTool,
    onCreateStickyAtCenter: handleToolbarCreate,
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
    onBoundary: boundaryRef.current,
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

  const handleSelect = useCallback(
    (id: string, shiftKey?: boolean) => {
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
      boundaryRef.current();
      selection.endEdit(_next);
    },
    [selection],
  );

  const handleDeleteSelection = useCallback(() => {
    boundaryRef.current();
    const ids = [...selection.ids];
    deleteObjects(board.doc, ids);
    selection.clear();
  }, [board.doc, selection]);

  const handleSetStickyColor = useCallback(
    (id: string, color: string) => {
      boundaryRef.current();
      setStickyColor(board.doc, id, color);
    },
    [board.doc],
  );

  const handleSizeChange = useCallback(
    (id: string, size: string) => {
      boundaryRef.current();
      setTextSize(board.doc, id, size);
    },
    [board.doc],
  );

  // Story 9: create text on click while Text tool is active
  const handleTextClick = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!canEdit || tool !== 'text') return;
      const result = createText(board.doc, worldPoint, 'unknown');
      if (result !== null && result !== undefined) {
        // Switch back to Select tool
        setTool('select');
        // Select and start editing the new text
        selection.click(result);
        selection.startEdit(result);
      }
    },
    [board.doc, canEdit, tool, selection, setTool],
  );

  const spacingPx = 24 * camera.zoom;
  const bgPosX = (-camera.x * camera.zoom) % spacingPx;
  const bgPosY = (-camera.y * camera.zoom) % spacingPx;

  // Merge snapshots for overlay/hit-test
  // We only pass stickies to SelectionOverlay since it uses objectBounds() which needs width/height
  // Text objects don't have width/height in the sticky snapshot type, but we handle them separately

  return (
    <>
      {/* Share button top-right */}
      <SharePanel boardId={boardId} />

      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={!canEdit}
        selectedTool={tool}
        onToolChange={(t) => {
          setTool(t);
          selection.clear();
        }}
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
          if (e.shiftKey) {
            marquee.begin({ x: e.clientX, y: e.clientY });
          }
        }}
        onEmptyPointerUp={() => {
          marquee.end();
        }}
        activeTool={tool}
        onTextClick={tool === 'text' ? handleTextClick : undefined}
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
        {/* Render text objects - read directly from Y.Doc */}
        {renderTextObjects(board.doc, camera, selection, handleSelect, handleStartEdit, handleEndEdit, boundary, gesture)}
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
            snapshot={board.snapshot as any}
            doc={board.doc}
            onDelete={handleDeleteSelection}
            onBoundary={boundary}
            onSizeChange={handleSizeChange}
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

/** Helper to render text objects by reading from Y.Doc directly. */
function renderTextObjects(
  doc: Y.Doc | null,
  camera: { x: number; y: number; zoom: number },
  selection: ReturnType<typeof useSelection>,
  handleSelect: (id: string, shiftKey?: boolean) => void,
  handleStartEdit: (id: string) => void,
  handleEndEdit: (next: 'selected' | 'unselected') => void,
  boundary: () => void,
  gesture: ReturnType<typeof useTransformGesture>,
) {
  if (!doc) return null;
  try {
    const objectsMap = (doc as any).getMap('objects');
    const texts: TextSnapshot[] = [];

    for (const [id, val] of objectsMap) {
      if (!(val instanceof Y.Map)) continue;
      const dm = val as any;
      if (String(dm.get('type') ?? '') !== 'text') continue;

      const textVal = dm.get('text');
      const textStr = textVal instanceof Y.Text ? textVal.toString() : '';

      texts.push({
        id,
        type: 'text' as const,
        x: Number(dm.get('x') ?? 0),
        y: Number(dm.get('y') ?? 0),
        z: Number(dm.get('z') ?? 0),
        createdAt: Number(dm.get('createdAt') ?? 0),
        text: textStr,
        size: (dm.get('size') as 'S' | 'M' | 'L' | 'XL') || 'M',
        widthMode: (dm.get('widthMode') as 'auto' | 'fixed') || 'auto',
        createdBy: dm.has('createdBy') ? String(dm.get('createdBy')) : undefined,
        width: dm.has('width') ? Number(dm.get('width')) : undefined,
        height: dm.has('height') ? Number(dm.get('height')) : undefined,
      });
    }

    return texts.map((note) => (
      <TextObject
        key={note.id}
        note={note}
        doc={doc}
        zoom={camera.zoom}
        selected={selection.ids.has(note.id)}
        editing={note.id === selection.editingId}
        onSelect={(id: string, shiftKey: boolean) => handleSelect(id, shiftKey)}
        onStartEdit={handleStartEdit}
        onEndEdit={handleEndEdit}
        onObjectPointerDown={(e: PointerEvent, id: string) => {
          gesture.onObjectPointerDown(e, id);
        }}
        onHandlePointerDown={(e: PointerEvent, h: Handle) => {
          gesture.onHandlePointerDown(e, h);
        }}
      />
    ));
  } catch {
    return null;
  }
}
