import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { type Size, canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import type { Point } from './canvas/camera';

/** Top-level layout: full-window board, zoom controls, first-use hint, sticky notes. */
export default function App(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return undefined;
  }, []);

  // Convert screen coordinates to world coordinates
  const screenPointToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = rootRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return screenToWorld(camera.camera, { x: sx, y: sy });
    },
    [camera.camera],
  );

  // Create a sticky note at a world point
  const createStickyAt = useCallback(
    (worldPoint: Point) => {
      const id = createSticky(doc, worldPoint);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit],
  );

  // Double-click on empty board space → create note centred there
  const handleDblClickEmpty = useCallback(
    (clientX: number, clientY: number) => {
      const world = screenPointToWorld(clientX, clientY);
      createStickyAt(world);
    },
    [screenPointToWorld, createStickyAt],
  );

  // Click on empty board space → clear selection
  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  // Toolbar button → create note at viewport centre
  const handleCreateSticky = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    const world = screenToWorld(camera.camera, centre);
    createStickyAt(world);
  }, [viewport, camera.camera, createStickyAt]);

  // Keyboard: Enter to edit, Delete/Backspace to delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, doc, select, startEdit]);

  return (
    <div className="app-root" ref={rootRef}>
      <BoardViewport
        camera={camera.camera}
        hasNavigated={camera.hasNavigated}
        beginPan={camera.beginPan}
        panMove={camera.panMove}
        endPan={camera.endPan}
        wheel={camera.wheel}
        zoomStep={camera.zoomStep}
        reset={camera.reset}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateSticky} />
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated && notes.length === 0} />
    </div>
  );
}
