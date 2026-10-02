import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { ObjectLayer } from './board/ObjectLayer';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import {
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  snapshot,
} from '../shared/board-model';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import './objects/registry';

/**
 * BoardUI: the collaborative whiteboard. Story 7 keeps selection generic — a
 * registry-driven object layer, a transform gesture (group move / box resize),
 * a marquee, a selection bar and board keyboard commands, all over a *set* of
 * selected ids.
 */
export function BoardUI({ boardId }: { boardId: string }) {
  const [viewport, setViewport] = useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewport);

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  const getViewportRect = useCallback((): DOMRect => {
    const el = document.querySelector('[data-testid="board-viewport"]');
    if (el) return el.getBoundingClientRect();
    const rect = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    return rect;
  }, []);

  // Always-current selection ids for the (once-registered) test hooks.
  const selectionRef = useRef<ReadonlySet<string>>(selection.ids);
  selectionRef.current = selection.ids;

  const marquee = useMarquee({
    selection,
    snapshot: notes,
    camera,
    canEdit: editable,
    getViewportRect,
  });

  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable });

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Register test hooks (no-op outside the test build mode)
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshot(doc),
      getSelection: () => [...selectionRef.current],
      addSticky: (at, text, color) => {
        const id = createSticky(doc, at, (color as never) ?? undefined);
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          t.insert(0, text);
        }
        return id;
      },
    });
  }, [setCamera, doc]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = (window as any).__vidi6 || {};
      (window as any).__vidi6.connectionState = connectionState;
    }
  }, [connectionState]);

  // Zoom keyboard shortcuts (Ctrl/Cmd +, -, 0)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomStep('in');
        } else if (e.key === '-') {
          e.preventDefault();
          zoomStep('out');
        } else if (e.key === '0') {
          e.preventDefault();
          reset();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset]);

  // A new note lands centred on the given screen point and opens for typing.
  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport]);

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      createAtScreenPoint(point);
    },
    [createAtScreenPoint],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, editable]);

  const handleBringToFront = useCallback(() => {
    if (!editable) return;
    bringObjectsToFront(doc, [...selection.ids]);
  }, [doc, selection, editable]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={gestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onSurfaceShiftPointerDown={marquee.startMarquee}
      >
        <ObjectLayer
          snapshot={notes}
          doc={doc}
          camera={camera}
          selectedIds={selection.ids}
          editingId={selection.editingId}
          draggingIds={gesture.draggingIds}
          editable={editable}
          onObjectPointerDown={gesture.onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={selection.endEdit}
        />
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={handleDeleteSelection}
        onBringToFront={handleBringToFront}
      />
      <MarqueeRect rect={marquee.marquee} />
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={!editable} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** Backward-compatible export for tests that import App */
export { BoardUI as App };
