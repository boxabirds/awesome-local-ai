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
import { ShapeObject } from '../objects/ShapeObject';
import { ConnectorObject } from '../objects/ConnectorObject';
import { StrokeObject } from '../objects/StrokeObject';
import { ImageObject } from '../objects/ImageObject';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
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
import type { SnapshotWithText } from '../board/SelectionBar';
import { createText, setTextSize } from '@shared/objects/text';
import { useTool } from '../board/useTool';
import type { Tool } from '../board/useTool';
import type { ObjectSnap, StickySnapshot, ShapeSnapshot, ConnectorSnapshot, StrokeSnapshot } from '@shared/board-model';
import type { TextSnapshot } from '@shared/objects/text';
import type { Handle } from '@shared/geometry';
import { objectBounds } from '@shared/board-model';
import { getObjectType } from '../objects/registry';
import type { ShapeKind } from '@shared/objects/shape';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { showToast, Toast } from '../ui/Toast';

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
  // Story 11: pen options
  const penOptions = usePenOptions();
  // Identity for stroke ownership
  const identityId = useMemo(() => crypto.randomUUID(), []);
  // Story 10: shape kind
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [hoverDots, setHoverDots] = useState<{ pos: { x: number; y: number }; highlighted: boolean }[]>([]);
  const [dragDotPos, setDragDotPos] = useState<{ x: number; y: number } | null>(null);
  const [connectorPreviewLine, setConnectorPreviewLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

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

  // ─── Story 12: Image insert hook ────────────────────────────────
  const [toasts, setToasts] = useState<string[]>([]);
  const toastQueue = useRef<string[]>([]);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToasts((prev) => [...prev.slice(-4), msg]);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToasts([]);
    }, 4000);
  }, []);

  const imageInsert = useImageInsert({
    doc: board.doc,
    boardId,
    camera,
    connection: globalConnState,
    identityId,
    viewSize: { width: viewportSize.width, height: viewportSize.height },
    toast: showToast,
  });

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
    window.__getStickyNotes = () =>
      board.snapshot.filter((o): o is StickySnapshot => o.type === 'sticky');
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

  // Story 10: shape creation from Shape tool
  const handleShapeCreated = useCallback((id: string) => {
    if (!canEdit) return;
    selection.click(id);
    setTool('select');
  }, [selection, canEdit, setTool]);

  // Story 10: connector creation from Connector tool
  const handleConnectorCreated = useCallback((id: string) => {
    if (!canEdit) return;
    selection.click(id);
    setTool('select');
  }, [selection, canEdit, setTool]);

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
        selectedTool={tool as any}
        onToolChange={(t: any) => {
          setTool(t);
          selection.clear();
        }}
        onOpenImagePicker={() => imageInsert.openPicker()}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* Story 11: Pen toolbar - visible only when Pen tool is active */}
      {tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={(c) => penOptions.setColor(c)}
          onThickness={(t) => penOptions.setThickness(t)}
        />
      )}
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
        {tool === 'pen' && (
          <PenTool
            camera={camera}
            color={penOptions.color}
            thickness={penOptions.thickness}
            doc={board.doc}
            identityId={identityId}
            onBoundary={boundary}
          />
        )}
        <MarqueeRect rect={marquee.rect ?? null} camera={camera} />
        {board.snapshot
          .filter((o): o is StickySnapshot => o.type === 'sticky')
          .map((note) => (
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
        {/* Render strokes */}
        {board.snapshot
          .filter((o): o is StrokeSnapshot => o.type === 'stroke')
          .map((s) => (
            <StrokeObject
              key={s.id}
              stroke={s}
              selected={selection.ids.has(s.id)}
            />
          ))}
        {/* Render shapes */}
        {board.snapshot
          .filter((o): o is ShapeSnapshot => o.type === 'shape' && o.kind === 'rect')
          .map((s) => (
            <ShapeObject
              key={s.id}
              snap={s}
              camera={camera}
              selected={selection.ids.has(s.id)}
            />
          ))}
        {/* Render connectors */}
        {board.snapshot
          .filter((o): o is ConnectorSnapshot => o.type === 'connector')
          .map((c) => (
            <ConnectorObject
              key={c.id}
              snap={c}
              boardSnapshot={board.snapshot}
              camera={camera}
              selected={selection.ids.has(c.id)}
            />
          ))}
        {/* Render images */}
        {renderImageObjects(board.doc, board.snapshot, imageInsert, identityId)}
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
            snapshot={board.snapshot as readonly SnapshotWithText[]}
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
      {/* Story 12: Image drop highlight overlay */}
      <DropHighlight enabled={canEdit} />
      {/* Story 12: Image toast messages */}
      <Toast visible={toasts.length > 0} />
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

/** Image data for rendering in BoardPage */
type ImageObjectProps = {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  assetKey: string | null;
  contentType: string;
  naturalWidth: number;
  naturalHeight: number;
  status: 'uploading' | 'ready' | 'failed';
  uploadStartedAt: number;
  uploaderId: string;
  z: number;
  createdAt: number;
};

/** Helper to render image objects from Y.Doc */
function renderImageObjects(
  doc: Y.Doc | null,
  snapshot: readonly ObjectSnap[],
  imageInsert: ReturnType<typeof useImageInsert>,
  identityId: string,
) {
  if (!doc) return null;
  try {
    const objectsMap = (doc as any).getMap('objects');
    const images: ImageObjectProps[] = [];

    for (const [id, val] of objectsMap) {
      if (!(val instanceof Y.Map)) continue;
      const dm = val as any;
      if (String(dm.get('type') ?? '') !== 'image') continue;

      const imgStatus = String(dm.get('status') ?? '');
      const assetKey = dm.has('assetKey') ? dm.get('assetKey') : null;
      const uploadStartedAt = Number(dm.get('uploadStartedAt') ?? 0);

      images.push({
        id,
        type: 'image' as const,
        x: Number(dm.get('x') ?? 0),
        y: Number(dm.get('y') ?? 0),
        width: Number(dm.get('width') ?? 200),
        height: Number(dm.get('height') ?? 150),
        assetKey,
        contentType: dm.has('contentType') ? String(dm.get('contentType')) : 'image/png',
        naturalWidth: Number(dm.get('naturalWidth') ?? 200),
        naturalHeight: Number(dm.get('naturalHeight') ?? 150),
        status: imgStatus as ImageObjectProps['status'],
        uploadStartedAt,
        uploaderId: dm.has('uploaderId') ? String(dm.get('uploaderId')) : '',
        z: Number(dm.get('z') ?? 0),
        createdAt: Number(dm.get('createdAt') ?? 0),
      });
    }

    // Sort by z-index
    images.sort((a, b) => a.z - b.z);

    const now = Date.now();
    return images.map((img) => {
      const progress = imageInsert.progress.get(img.id);
      const isUploader = img.uploaderId === identityId;
      return (
        <div
          key={img.id}
          style={{ position: 'absolute' }}
          data-image-id={img.id}
        >
          {renderSingleImageObject(
            doc,
            {
              id: img.id,
              type: 'image' as const,
              x: img.x,
              y: img.y,
              width: img.width,
              height: img.height,
              assetKey: img.assetKey,
              contentType: img.contentType,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              status: img.status,
              uploadStartedAt: img.uploadStartedAt,
              uploaderId: img.uploaderId,
              z: img.z,
              createdAt: img.createdAt,
            },
            progress,
            isUploader,
            imageInsert.canRetry(img.id),
            now,
          )}
        </div>
      );
    });
  } catch {
    return null;
  }
}

/** Render a single image object inline */
function renderSingleImageObject(
  doc: Y.Doc | null,
  img: ImageObjectProps,
  progress: number | undefined,
  isUploader: boolean,
  canRetry: boolean,
  now: number,
) {
  const IMAGE_UPLOAD_STALE_MS = 30_000;
  const displayStatus:
    | 'uploading'
    | 'ready'
    | 'failed'
    | 'unfinished' = (() => {
    if (img.status === 'ready') return 'ready';
    if (img.status === 'failed') return 'failed';
    if (now - img.uploadStartedAt >= IMAGE_UPLOAD_STALE_MS) return 'unfinished';
    return 'uploading';
  })();

  // Unfinished state
  if (displayStatus === 'unfinished') {
    return (
      <div
        style={{
          position: 'absolute',
          left: img.x,
          top: img.y,
          width: img.width,
          height: img.height,
          background: '#f5f5f5',
          border: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#999' }}>Image upload didn't finish</span>
        <button
          onClick={() => deleteObjects(doc!, [img.id])}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  if (displayStatus === 'failed') {
    if (isUploader) {
      return (
        <div
          style={{
            position: 'absolute',
            left: img.x,
            top: img.y,
            width: img.width,
            height: img.height,
            background: '#ffebee',
            border: '2px solid #f44336',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: '#c62828', fontWeight: 500 }}>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button
                onClick={() => showToast('Retrying...')}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            )}
            <button
              onClick={() => deleteObjects(doc!, [img.id])}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        style={{
          position: 'absolute',
          left: img.x,
          top: img.y,
          width: img.width,
          height: img.height,
          background: '#f5f5f5',
          border: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
        <span style={{ fontSize: 11, color: '#999' }}>Image unavailable</span>
      </div>
    );
  }

  if (displayStatus === 'uploading') {
    return (
      <div
        style={{
          position: 'absolute',
          left: img.x,
          top: img.y,
          width: img.width,
          height: img.height,
          background: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 12, color: '#666' }}>
          {isUploader && progress !== undefined ? `${progress}%` : 'Uploading…'}
        </span>
        {isUploader && progress !== undefined && (
          <div
            style={{
              width: '80%',
              height: 6,
              background: '#ccc',
              borderRadius: 3,
              overflow: 'hidden',
              marginTop: 4,
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: '#2196F3',
                borderRadius: 3,
                transition: 'width 0.2s',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Ready state
  return (
    <div
      style={{
        position: 'absolute',
        left: img.x,
        top: img.y,
        width: img.width,
        height: img.height,
        overflow: 'hidden',
        cursor: 'default',
      }}
    >
      <img
        src={`/api/assets/${img.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </div>
  );
}
