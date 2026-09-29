import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Camera, Point, Size, canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '@client/canvas/camera';
import type { Rect } from '@shared/geometry';
import { useCamera } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { NavigationHint } from '@client/canvas/NavigationHint';
import { setupTestHooks, setTestConnectionState } from '@client/canvas/testHooks';
import { useBoardDoc } from '@client/board/useBoardDoc';
import { useSelection } from '@client/board/useSelection';
import { useTransformGesture } from '@client/board/useTransformGesture';
import { useBoardKeys } from '@client/board/useBoardKeys';
import { useUndo } from '@client/board/useUndo';
import { createUndo, type UndoController } from '@client/board/undo';
import { useMarquee, MarqueeRect } from '@client/board/Marquee';
import { SelectionOverlay } from '@client/board/SelectionOverlay';
import { SelectionBar } from '@client/board/SelectionBar';
import { Toolbar } from '@client/board/Toolbar';
import { StickyNote } from '@client/objects/StickyNote';
import { TextObject } from '@client/objects/TextObject';
import { ShapeObject } from '@client/objects/ShapeObject';
import { ConnectorObject } from '@client/objects/ConnectorObject';
import { ShapeTool } from '@client/tools/ShapeTool';
import { ConnectorTool } from '@client/tools/ConnectorTool';
import { useActiveTool } from '@client/tools/useActiveTool';
import { ConnectionStatus } from '@client/sync/ConnectionStatus';
import { canEdit } from '@client/sync/connectBoard';
import { createSticky, deleteObjects, getObjectRect, objectBounds } from '@shared/board-model';
import { createText } from '@shared/objects/text';
import { SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD } from '@shared/config';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { resolveEndpoints } from '@shared/geometry/connector-geometry';
import { scaledPoints } from '@shared/objects/stroke';
import { StrokeObject } from '@client/objects/StrokeObject';
import { PenTool } from '@client/tools/PenTool';
import { PenToolbar } from '@client/tools/PenToolbar';
import { usePenOptions } from '@client/tools/usePenOptions';

// Register the sticky type at import time
import { registerStickyType } from '@client/objects/registry';
registerStickyType(StickyNote);

// Register the text type at import time
import { registerObjectType } from '@client/objects/registry';
import { TEXT_MIN_WIDTH_WORLD } from '@shared/config';
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj, worldPoint) {
    const w = (obj as any).width ?? 100;
    const h = (obj as any).height ?? 20;
    return (
      worldPoint.x >= obj.x &&
      worldPoint.x <= obj.x + w &&
      worldPoint.y >= obj.y &&
      worldPoint.y <= obj.y + h
    );
  },
});

// Register the shape type at import time
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj, worldPoint) {
    const w = (obj as any).width ?? 160;
    const h = (obj as any).height ?? 160;
    return (
      worldPoint.x >= obj.x &&
      worldPoint.x <= obj.x + w &&
      worldPoint.y >= obj.y &&
      worldPoint.y <= obj.y + h
    );
  },
});

// Register the connector type at import time
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj, worldPoint) {
    const from = (obj as any).from as Point;
    const to = (obj as any).to as Point;
    if (!from || !to) return false;
    // 8px tolerance in world units is a reasonable default; the component uses zoom-adjusted hit lines
    const tol = CONNECTOR_HIT_TOLERANCE_PX;
    return distanceToPolyline([from, to], worldPoint) <= tol;
  },
});

// Register the stroke type at import time
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj, worldPoint, zoom = 1) {
    const s = obj as any;
    if (!s.points) return false;
    const pts = scaledPoints(s);
    const tol = Math.max((PEN_THICKNESS_WORLD as any)[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    return distanceToPolyline(pts, worldPoint) <= tol;
  },
});

export function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, wheel, gestureZoom, zoomStep, reset, setCamera } = cameraState;

  const { doc, notes, allObjects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(allObjects);

  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  // Create one undo controller per board doc; destroy on board change/unmount
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => {
    return () => undoController.destroy();
  }, [undoController]);

  const editable = canEdit(connectionState);
  const undoState = useUndo(undoController, editable);
  const selectCreated = useCallback((id: string) => selection.click(id), [selection]);
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    onSelect: selectCreated,
  });
  const penOptions = usePenOptions();

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setViewportSize({ width, height });
      }
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, []);

  // Test hooks
  const testHookRef = useRef({ doc, boardId });
  testHookRef.current = { doc, boardId };
  useEffect(() => {
    setupTestHooks(setCamera, () => cameraRef.current, {
      getDoc: () => testHookRef.current.doc,
      getBoardId: () => testHookRef.current.boardId,
    });
  }, [setCamera]);

  useEffect(() => {
    setTestConnectionState(connectionState);
  }, [connectionState]);

  // Transform gesture with undo boundaries
  const onGestureStart = useCallback(() => { undoController.boundary(); }, [undoController]);
  const onGestureEnd = useCallback(() => { undoController.boundary(); }, [undoController]);

  const transform = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: allObjects,
    canEdit: editable,
    onGestureStart,
    onGestureEnd,
  });

  // Marquee
  const marquee = useMarquee(camera, allObjects, useCallback((ids: string[]) => {
    selection.setMany(ids, false);
  }, [selection.setMany]));

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: allObjects,
    canEdit: editable,
    undoController,
    tool,
    setTool,
  });

  // Delete selection callback
  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, selection.ids, selection.clear, editable, undoController]);

  const createAtWorldCentre = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    const cam = cameraRef.current;
    const centre: Point = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    undoController.boundary();
    if (id) selection.startEdit(id);
  }, [doc, viewportSize.width, viewportSize.height, editable, undoController]);

  const handleDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      if (!editable) return;
      if (tool === 'text') return; // text tool handles click, not double-click
      undoController.boundary();
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [doc, editable, undoController, tool],
  );

  const handleClickEmpty = useCallback(
    (screenPoint: Point) => {
      if (!editable) {
        selection.clear();
        return;
      }
      if (tool === 'text') {
        // Create text at clicked world point
        undoController.boundary();
        const cam = cameraRef.current;
        const world = screenToWorld(cam, screenPoint);
        const id = createText(doc, world, 'user');
        undoController.boundary();
        setTool('select');
        if (id) selection.startEdit(id);
        return;
      }
      selection.clear();
    },
    [doc, editable, undoController, tool, setTool, selection],
  );

  // Live rects for connector endpoint resolution and drop hit-testing
  const objectRects = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const o of allObjects) {
      if (o.type === 'connector') continue;
      const b = objectBounds(o);
      m.set(o.id, b);
    }
    return m;
  }, [allObjects]);

  // Check if any selected type has resizable handles
  const showHandles = selection.ids.size > 0 && editable;

  const renderOrder = [...allObjects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const cursorStyle = tool === 'text' ? 'text' : tool === 'shape' || tool === 'connector' || tool === 'pen' ? 'crosshair' : 'grab';

  const handlePenCommit = useCallback(() => {
    undoController.boundary();
  }, [undoController]);

  const activeToolOverlay =
    tool === 'shape' ? (
      <ShapeTool kind={shapeKind} camera={camera} doc={doc} onCreated={toolCreated} />
    ) : tool === 'connector' ? (
      <ConnectorTool camera={camera} doc={doc} snapshot={allObjects} onCreated={toolCreated} />
    ) : tool === 'pen' ? (
      <PenTool camera={camera} color={penOptions.color} thickness={penOptions.thickness} doc={doc} identityId="user" onCommit={handlePenCommit} wheel={wheel} gestureZoom={gestureZoom} />
    ) : null;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <BoardViewport
        camera={camera}
        cursor={cursorStyle}
        beginPan={tool === 'text' || tool === 'shape' || tool === 'connector' || tool === 'pen' ? undefined : cameraState.beginPan}
        panMove={cameraState.panMove}
        endPan={cameraState.endPan}
        wheel={wheel}
        gestureZoom={gestureZoom}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onClickEmpty={handleClickEmpty}
        onMarqueeBegin={tool === 'text' || tool === 'shape' || tool === 'connector' || tool === 'pen' ? undefined : marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {renderOrder.map((obj) => {
          if (obj.type === 'text') {
            return (
              <TextObject
                key={obj.id}
                note={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={obj.id === selection.editingId}
                dragging={transform.draggingId === obj.id}
                readOnly={!editable}
                onSelect={selection.click}
                onToggle={selection.toggle}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
                onObjectPointerDown={transform.onObjectPointerDown}
                undoController={undoController}
              />
            );
          }
          if (obj.type === 'shape') {
            return (
              <ShapeObject
                key={obj.id}
                shape={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={obj.id === selection.editingId}
                dragging={transform.draggingId === obj.id}
                readOnly={!editable}
                onSelect={selection.click}
                onToggle={selection.toggle}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
                onObjectPointerDown={transform.onObjectPointerDown}
                undoController={undoController}
              />
            );
          }
          if (obj.type === 'stroke') {
            return (
              <StrokeObject
                key={obj.id}
                stroke={obj}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                readOnly={!editable}
                onSelect={selection.click}
                onToggle={selection.toggle}
                onObjectPointerDown={transform.onObjectPointerDown}
              />
            );
          }
          if (obj.type === 'connector') {
            return (
              <ConnectorObject
                key={obj.id}
                connector={obj}
                doc={doc}
                zoom={camera.zoom}
                camera={camera}
                rects={objectRects}
                selected={selection.ids.has(obj.id)}
                readOnly={!editable}
                onSelect={selection.click}
                onToggle={selection.toggle}
                undoController={undoController}
              />
            );
          }
          return (
            <StickyNote
              key={obj.id}
              note={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={obj.id === selection.editingId}
              dragging={transform.draggingId === obj.id}
              readOnly={!editable}
              onSelect={selection.click}
              onToggle={selection.toggle}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              onObjectPointerDown={transform.onObjectPointerDown}
              undoController={undoController}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={allObjects}
        camera={camera}
        showHandles={showHandles}
        onHandlePointerDown={transform.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={allObjects}
        camera={camera}
        onDelete={handleDeleteSelection}
      />
      <Toolbar
        onCreateSticky={createAtWorldCentre}
        disabled={!editable}
        undoState={undoState}
        tool={tool}
        onToolChange={setTool}
        shapeKind={shapeKind}
        onShapeKindChange={setShapeKind}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
      {tool === 'pen' && <PenToolbar color={penOptions.color} thickness={penOptions.thickness} onColor={penOptions.setColor} onThickness={penOptions.setThickness} />}
      {activeToolOverlay}
    </div>
  );
}
