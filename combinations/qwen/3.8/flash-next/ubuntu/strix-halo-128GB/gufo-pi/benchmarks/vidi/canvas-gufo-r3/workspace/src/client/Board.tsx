import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Camera, Point, Size, canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '@client/canvas/camera';
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
import { ConnectionStatus } from '@client/sync/ConnectionStatus';
import { canEdit } from '@client/sync/connectBoard';
import { createSticky, deleteObjects } from '@shared/board-model';

// Register the sticky type at import time
import { registerStickyType } from '@client/objects/registry';
registerStickyType(StickyNote);

export function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, wheel, gestureZoom, zoomStep, reset, setCamera } = cameraState;

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);

  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  // Create one undo controller per board doc; destroy on board change/unmount
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => {
    return () => undoController.destroy();
  }, [undoController]);

  const editable = canEdit(connectionState);
  const undoState = useUndo(undoController, editable);

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
  useEffect(() => {
    setupTestHooks(setCamera, () => cameraRef.current);
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
    snapshot: notes,
    canEdit: editable,
    onGestureStart,
    onGestureEnd,
  });

  // Marquee
  const marquee = useMarquee(camera, notes, useCallback((ids: string[]) => {
    selection.setMany(ids, false);
  }, [selection.setMany]));

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
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
      undoController.boundary();
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [doc, editable, undoController],
  );

  // Check if any selected type has resizable handles
  const showHandles = selection.ids.size > 0 && editable;

  const renderOrder = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <BoardViewport
        camera={camera}
        beginPan={cameraState.beginPan}
        panMove={cameraState.panMove}
        endPan={cameraState.endPan}
        wheel={wheel}
        gestureZoom={gestureZoom}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onClickEmpty={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {renderOrder.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            dragging={transform.draggingId === note.id}
            readOnly={!editable}
            onSelect={selection.click}
            onToggle={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onObjectPointerDown={transform.onObjectPointerDown}
            undoController={undoController}
          />
        ))}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        showHandles={showHandles}
        onHandlePointerDown={transform.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={handleDeleteSelection}
      />
      <Toolbar
        onCreateSticky={createAtWorldCentre}
        disabled={!editable}
        undoState={undoState}
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
    </div>
  );
}
