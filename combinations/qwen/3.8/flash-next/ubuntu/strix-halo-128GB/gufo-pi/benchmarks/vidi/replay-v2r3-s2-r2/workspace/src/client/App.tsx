import React, { useEffect, useCallback, useState } from 'react';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera';
import { createSticky, deleteObject } from '../shared/board-model';

function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

export function App() {
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

  const { doc, notes } = useBoardDoc();

  // Render notes in a stable order (by id) and rely on CSS z-index for stacking.
  // Reordering DOM nodes when z changes would drop pointer capture mid-drag, so
  // bring-to-front only mutates the z value, never the child order.
  const renderNotes = React.useMemo(
    () => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes],
  );
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

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

  // Clear selection when the selected/edited note disappears from the doc
  // (e.g. deleted via the toolbar's bin button or the Delete key).
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) {
      select(null);
    }
  }, [notes, selectedId, select]);

  // Zoom keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset]);

  // Note keyboard shortcuts: Enter to edit the selected note; Delete/Backspace
  // to remove it. Ignored while editing text or when focus is in any input.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId !== null) return; // keys edit the text, handled by the textarea
      if (isTextEntryTarget(e.target) || isTextEntryTarget(document.activeElement)) return;

      if (e.key === 'Enter') {
        if (selectedId !== null) {
          e.preventDefault();
          startEdit(selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId !== null) {
          e.preventDefault();
          deleteObject(doc, selectedId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingId, selectedId, doc, startEdit]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  const createAndEdit = useCallback(
    (worldPoint: { x: number; y: number }) => {
      const id = createSticky(doc, worldPoint);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Double-click on empty board space: create a note centred on that point.
  const handleCreateAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      createAndEdit(screenToWorld(camera, point));
    },
    [camera, createAndEdit],
  );

  // Toolbar button: create a note centred in the visible board area.
  const handleCreateSticky = useCallback(() => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    createAndEdit(screenToWorld(camera, centre));
  }, [camera, viewport, createAndEdit]);

  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={handleGestureZoom}
        onCreateAtScreenPoint={handleCreateAtScreenPoint}
        onEmptyClick={handleEmptyClick}
      >
        {renderNotes.map((note) => (
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
      <Toolbar onCreateSticky={handleCreateSticky} />
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
