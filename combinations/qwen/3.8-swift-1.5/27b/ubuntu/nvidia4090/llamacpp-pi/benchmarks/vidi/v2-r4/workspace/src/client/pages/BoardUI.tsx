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
import { getRegisteredTypes } from '../objects/registry';
import { StickyNoteComponent } from '../objects/StickyNote';

// Initialize the registry types for board-model
setRegisteredTypes(getRegisteredTypes());

export function BoardUI({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 });

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCamera } =
    useCamera(viewportSize);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const canEdit = connectionState !== 'load_failed';

  // Marquee
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, false);
  });

  // Transform gesture
  const { onObjectPointerDown, onHandlePointerDown } = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit,
  });

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit,
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
    installTestHooks(setCamera);
  }, [setCamera]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (!(window as any).__vidi6) (window as any).__vidi6 = {};
    (window as any).__vidi6.connectionState = connectionState;
  }, [connectionState]);

  // Create a sticky note at a world point
  const createStickyAt = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      const id = createSticky(doc, worldPoint);
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, canEdit],
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

  // Handle delete from selection bar
  const handleDeleteSelection = useCallback(() => {
    if (selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection]);

  // Handle color change from selection bar
  const handleColorChange = useCallback(
    (id: string, color: string) => {
      setStickyColor(doc, id, color);
    },
    [doc],
  );

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
      >
        {notes.map((note) => (
          <StickyNoteComponent
            key={note.id}
            obj={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={selection.editingId === note.id}
            editable={canEdit}
            onPointerDown={onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}

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
            />
          </div>
        )}
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
