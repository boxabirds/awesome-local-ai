import React, { useEffect, useCallback, useState } from 'react';
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
import { SelectionBar } from './board/SelectionBar';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObjects, snapshot } from '../shared/board-model';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/**
 * BoardUI: the stories 1–7 board UI. Requires a boardId (existence already checked).
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

  // Transform gesture (group move and resize)
  const transform = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  // Marquee (Shift+drag selection)
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Keyboard commands (select all, clear, nudge, delete)
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

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

  // Keyboard shortcuts for zoom (Ctrl/Cmd +, -, 0)
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

  // Enter edits the selected note (single selected sticky). Never while typing.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!editable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = [...selection.ids][0];
        // Only sticky notes are editable
        const obj = notes.find((n) => n.id === id);
        if (obj?.type === 'sticky') {
          selection.startEdit(id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, editable, notes]);

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

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      selection.endEdit();
      if (next === 'unselected') selection.clear();
    },
    [selection],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
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
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        overlayChildren={
          <SelectionOverlay
            ids={selection.ids}
            snapshot={notes}
            camera={camera}
            onHandlePointerDown={transform.onHandlePointerDown}
          />
        }
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onStartEdit={selection.startEdit}
            onEndEdit={handleEndEdit}
            editable={editable}
            onPointerDown={transform.onObjectPointerDown}
          />
        ))}
      </BoardViewport>
      {/* Marquee rectangle (screen space) */}
      <MarqueeRect rect={marquee.rect} camera={camera} />
      {/* Selection bar */}
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={handleDeleteSelection}
      />
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
