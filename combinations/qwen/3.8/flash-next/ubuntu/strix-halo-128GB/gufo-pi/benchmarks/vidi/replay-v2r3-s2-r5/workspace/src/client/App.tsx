import React, { useCallback, useEffect, useState } from 'react';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { screenToWorld, zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc, type BoardStore } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';

export interface AppProps {
  /** Injected store for component tests; the app owns its own document otherwise. */
  store?: BoardStore;
}

export function App({ store }: AppProps = {}) {
  const [viewport, setViewport] = useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const { doc, notes } = useBoardDoc(store);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

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

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Register test hooks
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      window.__vidi6 = { setCamera };
    }
  }, [setCamera]);

  // A note that disappears (deleted here or, later, by somebody else) must not
  // stay selected or keep an editor open.
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  // Keyboard shortcuts
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
        return;
      }

      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable === true);

      if (e.key === 'Enter') {
        // sticky.edit_start: only for a selected note, never from inside a field.
        if (inField || editingId !== null || !selectedId) return;
        e.preventDefault();
        startEdit(selectedId);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // sticky.delete: while editing these keys belong to the textarea.
        if (inField || editingId !== null || !selectedId) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset, selectedId, editingId, startEdit, doc, select]);

  const createAtWorldPoint = useCallback(
    (point: { x: number; y: number }) => {
      const id = createSticky(doc, point);
      if (id) startEdit(id);
      return id;
    },
    [doc, startEdit],
  );

  const handleDoubleClickBoard = useCallback(
    (screenPoint: { x: number; y: number }) => {
      createAtWorldPoint(screenToWorld(camera, screenPoint));
    },
    [camera, createAtWorldPoint],
  );

  const handleCreateFromToolbar = useCallback(() => {
    // Centre of the visible board area, wherever the board is panned to.
    createAtWorldPoint(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAtWorldPoint, viewport]);

  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={handleGestureZoom}
        onDoubleClickBoard={handleDoubleClickBoard}
        onClickEmpty={handleClickEmpty}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateFromToolbar} />
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
