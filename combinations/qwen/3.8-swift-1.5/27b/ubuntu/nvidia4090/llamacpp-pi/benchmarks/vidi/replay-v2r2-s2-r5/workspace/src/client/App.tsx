import { useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, type Camera } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { type Point } from './canvas/camera';

declare global {
  interface Window {
    __vidi6?: { setCamera(cam: Camera): void };
  }
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 800 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStepFn, reset, setCamera } =
    useCamera(size);

  const { doc, snapshots } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const [isPanning, setIsPanning] = useState(false);

  const handlePointerDown = (p: Point) => {
    setIsPanning(true);
    beginPan(p);
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    endPan();
  };

  const handlePointerCancel = () => {
    setIsPanning(false);
    endPan();
  };

  // Create sticky at a world point
  const createStickyAt = useCallback(
    (worldPoint: Point) => {
      const id = createSticky(doc, worldPoint);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit]
  );

  // Handle double-click on empty board space
  const handleDblClickEmpty = useCallback(
    (screenPoint: Point) => {
      const worldPoint = screenToWorld(camera, screenPoint);
      createStickyAt(worldPoint);
    },
    [camera, createStickyAt]
  );

  // Handle toolbar button - create at viewport centre
  const handleToolbarCreate = useCallback(() => {
    const centre: Point = { x: size.width / 2, y: size.height / 2 };
    const worldPoint = screenToWorld(camera, centre);
    createStickyAt(worldPoint);
  }, [camera, size, createStickyAt]);

  // Handle empty click - clear selection
  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler for Enter and Delete/Backspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, editingId, doc, select, startEdit]);

  // Expose test hook for e2e tests
  useEffect(() => {
    window.__vidi6 = { setCamera };
    return () => {
      delete window.__vidi6;
    };
  }, [setCamera]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <BoardViewport
        camera={camera}
        isPanning={isPanning}
        onPointerDown={handlePointerDown}
        onPointerMove={panMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={wheel}
        onKeyZoomIn={() => zoomStepFn('in')}
        onKeyZoomOut={() => zoomStepFn('out')}
        onKeyReset={reset}
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
      >
        {snapshots.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleToolbarCreate} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStepFn('in')}
        onZoomOut={() => zoomStepFn('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
