// src/client/App.tsx
import { useEffect, useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { screenToWorld } from './canvas/camera';
import type { Size, Camera, Point } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';

// Test-only hook
declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
    };
  }
}

function App(): ReactElement {
  const [viewport, setViewport] = useState<Size>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cam = useCamera(viewport);
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();

  // Track viewport size
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Expose test hook in test mode
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      window.__vidi6 = {
        setCamera: (c: Camera) => {
          cam.setCamera(c);
        },
      };
    }
    return () => {
      delete window.__vidi6;
    };
  });

  // Create sticky at a screen point
  const createStickyAtScreen = useCallback((screenPoint: Point) => {
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    const id = createSticky(doc, worldPoint);
    if (id) {
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection]);

  // Create sticky at viewport centre (toolbar button)
  const createStickyAtCentre = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createStickyAtScreen(centre);
  }, [viewport, createStickyAtScreen]);

  // Handle double-click on empty board space
  const handleDblClickEmpty = useCallback((screenPoint: Point) => {
    createStickyAtScreen(screenPoint);
  }, [createStickyAtScreen]);

  // Handle click on empty board space (clear selection)
  const handleClickEmpty = useCallback(() => {
    selection.select(null);
  }, [selection]);

  // Keyboard shortcuts: Enter to edit, Delete/Backspace to delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle keys when focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Enter' && selection.selectedId && !selection.editingId) {
        e.preventDefault();
        selection.startEdit(selection.selectedId);
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.selectedId && !selection.editingId) {
        e.preventDefault();
        deleteObject(doc, selection.selectedId);
        selection.select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection.selectedId, selection.editingId, selection, doc]);

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomIn={cam.zoomIn}
        zoomOut={cam.zoomOut}
        reset={cam.reset}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCentre} />
      <ZoomControls
        zoomPercent={cam.zoomPercent}
        canZoomIn={cam.canZoomIn}
        canZoomOut={cam.canZoomOut}
        onZoomIn={cam.zoomIn}
        onZoomOut={cam.zoomOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />
    </>
  );
}

export { App };
