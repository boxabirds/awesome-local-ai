import React, { useEffect, useCallback, useState, useRef } from 'react';
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
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar, SelectionAnnouncement } from './board/SelectionBar';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObjects, snapshot, objectsInRect } from '../shared/board-model';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { Rect } from '../shared/geometry';

/**
 * BoardUI: the board UI for stories 1–7.
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
  const { editingId, startEdit, endEdit } = selection;

  // A board that failed to load is read-only.
  const editable = canEdit(connectionState);

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  // Marquee
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const getObjectsInRectFn = useCallback((rect: Rect): string[] => {
    return objectsInRect(notesRef.current, rect);
  }, []);

  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  }, getObjectsInRectFn);

  // Force re-render for marquee rect display
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);

  const handleMarqueeBegin = useCallback((p: { x: number; y: number }) => {
    marquee.begin(p);
  }, [marquee]);

  const handleMarqueeMove = useCallback((p: { x: number; y: number }) => {
    marquee.move(p);
    setMarqueeRect(marquee.getRect());
  }, [marquee]);

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
    setMarqueeRect(null);
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
    setMarqueeRect(null);
  }, [marquee]);

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  // Register test hooks (no-op outside the test build mode)
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshot(doc),
      addSticky: (at, text, color) => {
        const id = createSticky(doc, at, (color as any) ?? undefined);
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

  // Zoom keyboard shortcuts
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

  // Enter edits the selected note (single selection only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId) return;
      if (selection.ids.size !== 1) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (!editable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = Array.from(selection.ids)[0];
        startEdit(id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection.ids, editingId, startEdit, editable]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  // A new note lands centred on the given screen point and opens for typing.
  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [camera, doc, startEdit, editable],
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
    const ids = Array.from(selection.ids);
    if (ids.length > 0) {
      deleteObjects(doc, ids);
      selection.clear();
    }
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
        onGestureZoom={handleGestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === editingId}
            onSelect={selection.click}
            onStartEdit={startEdit}
            onEndEdit={(next) => endEdit(next)}
            editable={editable}
            onObjectPointerDown={gesture.onObjectPointerDown}
            dragging={gesture.isDragging && selection.ids.has(note.id)}
          />
        ))}
      </BoardViewport>
      {/* Marquee rectangle rendered in screen space */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1002 }}>
        <MarqueeRect rect={marqueeRect} camera={camera} />
      </div>
      {/* Selection overlay with bounding box and handles */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {/* Selection bar (N selected + delete) */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000 }}>
        <SelectionBar
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onDelete={handleDeleteSelection}
        />
      </div>
      {/* Aria-live announcement */}
      <SelectionAnnouncement count={selection.ids.size} />
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
