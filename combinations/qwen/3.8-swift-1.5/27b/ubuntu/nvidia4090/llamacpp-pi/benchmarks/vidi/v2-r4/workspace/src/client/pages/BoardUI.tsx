import { useRef, useEffect, useState, useCallback } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '../canvas/camera';
import { installTestHooks } from '../canvas/testHooks';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTool } from '../board/useTool';
import { createUndo, type UndoController } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { SharePanel } from '../share/SharePanel';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  setRegisteredTypes,
} from '../../shared/board-model';
import { createText, setTextSize } from '../../shared/objects/text';
import { setShapeStyle } from '../../shared/objects/shape';
import { setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import type { ShapeSnap } from '../../shared/objects/shape';
import { objectBounds } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { getRegisteredTypes, getObjectType } from '../objects/registry';

// Initialize the registry types for board-model
setRegisteredTypes(getRegisteredTypes());

// Session identity for createdBy (story 6 identity is out of scope; a stable
// per-tab id keeps the schema field meaningful).
const SESSION_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `session-${Math.random().toString(36).slice(2)}`;

export function BoardUI({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 });

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCamera } =
    useCamera(viewportSize);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const canEdit = connectionState !== 'load_failed';

  // Per-user undo/redo controller (story 8): one per board, session-only.
  // Created in an effect (StrictMode-safe) and re-created on board change;
  // history never survives a board switch (undo.session_only).
  const [undo, setUndo] = useState<UndoController | null>(null);
  useEffect(() => {
    if (!boardId) return;
    const controller = createUndo(doc);
    setUndo(controller);
    return () => {
      controller.destroy();
      setUndo(null);
    };
  }, [doc, boardId]);

  // Marquee
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, false);
  });

  // Transform gesture. Boundaries at gesture start and end (incl. cancel) so
  // one drag is always exactly one undo step and never merges with neighbours
  // (undo.boundary).
  const { onObjectPointerDown, onHandlePointerDown } = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit,
    onGestureStart: () => undo?.boundary(),
    onGestureEnd: () => undo?.boundary(),
  });

  // Undo/redo bindings for the toolbar and keyboard shortcuts (story 8)
  const undoControls = useUndo(undo);

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit,
    undo: undo ?? undefined,
  });

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
    installTestHooks(setCamera, doc);
  }, [setCamera, doc]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (!(window as any).__vidi6) (window as any).__vidi6 = {};
    (window as any).__vidi6.connectionState = connectionState;
  }, [connectionState]);

  // Create a sticky note at a world point (bounded: one undo step)
  const createStickyAt = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      undo?.boundary();
      const id = createSticky(doc, worldPoint);
      if (id) {
        selection.startEdit(id);
      }
      undo?.boundary();
    },
    [doc, selection, canEdit, undo],
  );

  // N shortcut creates a sticky at the view centre (story 2 behaviour)
  const createStickyAtCentre = useCallback(() => {
    const centre = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const worldPoint = screenToWorld(camera, centre);
    createStickyAt(worldPoint);
  }, [camera, viewportSize, createStickyAt]);

  // Tool mode (story 9 + 10): select | text | shape | connector, with shortcuts
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useTool({
    canEdit,
    editingId: selection.editingId,
    onCreateStickyAtCentre: createStickyAtCentre,
    onToolCreated: (id) => {
      selection.click(id);
    },
  });

  // Create a text object at a world point, start editing it, and switch the
  // tool back to Select (text.create sequence).
  const createTextAt = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      undo?.boundary();
      const id = createText(doc, worldPoint, SESSION_ID);
      if (id) {
        setTool('select');
        selection.startEdit(id);
      }
      undo?.boundary();
    },
    [doc, selection, canEdit, undo, setTool],
  );

  // Text tool: board click creates a text at the world point
  const handleTextToolClick = useCallback(
    (screenPoint: { x: number; y: number }) => {
      const worldPoint = screenToWorld(camera, screenPoint);
      createTextAt(worldPoint);
    },
    [camera, createTextAt],
  );

  // Text size change from the selection bar (bounded: one undo step; the box
  // remeasure happens inside the same capture window via the object's local
  // change observer).
  const handleTextSize = useCallback(
    (id: string, size: string) => {
      if (!setTextSize(doc, id, size)) return;
      undo?.boundary();
    },
    [doc, undo],
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
    selection.clear();
  }, [selection]);

  // Handle marquee begin
  const handleMarqueeBegin = useCallback(
    (p: { x: number; y: number }) => {
      selection.clear();
      marquee.begin(p);
    },
    [marquee, selection],
  );

  // Handle marquee move
  const handleMarqueeMove = useCallback(
    (p: { x: number; y: number }) => {
      marquee.move(p);
    },
    [marquee],
  );

  // Handle marquee end
  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  // Handle marquee cancel
  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  // Handle delete from selection bar (bounded: one undo step)
  const handleDeleteSelection = useCallback(() => {
    if (selection.ids.size === 0) return;
    undo?.boundary();
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
    undo?.boundary();
  }, [doc, selection, undo]);

  // Handle color change from selection bar (bounded: one undo step)
  const handleColorChange = useCallback(
    (id: string, color: string) => {
      undo?.boundary();
      setStickyColor(doc, id, color);
      undo?.boundary();
    },
    [doc, undo],
  );

  // Handle shape style change (story 10, bounded: one undo step)
  const handleShapeStyle = useCallback(
    (id: string, s: { fill?: string; stroke?: string }) => {
      if (!setShapeStyle(doc, id, s)) return;
      undo?.boundary();
    },
    [doc, undo],
  );

  // Handle connector endpoint reattach (story 10, bounded: one undo step)
  const handleConnectorReattach = useCallback(
    (connectorId: string, end: 'from' | 'to', ep: Endpoint) => {
      if (!setConnectorEndpoint(doc, connectorId, end, ep)) return;
      undo?.boundary();
    },
    [doc, undo],
  );

  // Build rects map for connector rendering
  const rectsMap = new Map<string, Rect>();
  for (const obj of notes) {
    const bounds = objectBounds(obj);
    rectsMap.set(obj.id, bounds);
  }

  // Find the selected shape for the toolbar
  const selectedShape = selection.ids.size === 1
    ? notes.find((o) => o.id === [...selection.ids][0] && o.type === 'shape') as ShapeSnap | undefined
    : undefined;

  return (
    <div
      ref={containerRef}
      style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}
    >
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
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        tool={tool}
        onTextToolClick={handleTextToolClick}
      >
        {notes.map((obj) => {
          // Registry-based rendering (story 9: text is the first type added
          // purely through the registry); unknown types are skipped.
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              editable={canEdit}
              onPointerDown={onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              onClearSelection={(id) => selection.toggle(id)}
              undo={undo ?? undefined}
              {...(obj.type === 'connector' ? { rects: rectsMap, onReattach: handleConnectorReattach } : {})}
            />
          );
        })}

        {/* Shape toolbar (story 10): shown when exactly one shape is selected */}
        {selectedShape && (
          <div
            style={{
              position: 'absolute',
              left: selectedShape.x,
              top: selectedShape.y,
              pointerEvents: 'none',
            }}
          >
            <div style={{ pointerEvents: 'all' }}>
              <ShapeToolbar
                fill={selectedShape.fill}
                stroke={selectedShape.stroke}
                onFill={(c) => handleShapeStyle(selectedShape.id, { fill: c })}
                onStroke={(c) => handleShapeStyle(selectedShape.id, { stroke: c })}
              />
            </div>
          </div>
        )}

        {/* Shape tool overlay (story 10) */}
        {tool === 'shape' && canEdit && (
          <ShapeTool
            kind={shapeKind}
            camera={camera}
            doc={doc}
            createdBy={SESSION_ID}
            onCreated={(id) => toolCreated(id)}
            onGestureEnd={() => undo?.boundary()}
          />
        )}

        {/* Connector tool overlay (story 10) */}
        {tool === 'connector' && canEdit && (
          <ConnectorTool
            camera={camera}
            doc={doc}
            snapshot={notes}
            createdBy={SESSION_ID}
            onCreated={(id) => toolCreated(id)}
            onGestureEnd={() => undo?.boundary()}
          />
        )}

        {/* Marquee rectangle */}
        <MarqueeRect rect={marquee.rect} camera={camera} />

        {/* Selection overlay (bounding box + handles) */}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onHandlePointerDown={onHandlePointerDown}
        />

        {/* Selection bar */}
        {selection.ids.size > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
            }}
          >
            <SelectionBar
              ids={selection.ids}
              snapshot={notes}
              doc={doc}
              onDelete={handleDeleteSelection}
              onColor={handleColorChange}
              onTextSize={handleTextSize}
            />
          </div>
        )}
      </BoardViewport>
      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={!canEdit}
        undo={undoControls}
        tool={tool}
        setTool={setTool}
        shapeKind={shapeKind}
        setShapeKind={setShapeKind}
      />
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
