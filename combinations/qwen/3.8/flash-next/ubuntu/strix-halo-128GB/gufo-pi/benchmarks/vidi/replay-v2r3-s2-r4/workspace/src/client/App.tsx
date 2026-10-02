import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { registerTestHooks } from './canvas/testHooks';
import type { Point, Size } from './canvas/camera';
import { screenToWorld, zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import './styles.css';

/** True when the keyboard belongs to a text field, not to the board. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
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

  const { doc, objects } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Latest values for callbacks that must not re-subscribe on every change.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const selectionRef = useRef({ selectedId, editingId });
  selectionRef.current = { selectedId, editingId };

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
    registerTestHooks({
      setCamera,
      getCamera: () => cameraRef.current,
      getObjects: () => objectsRef.current,
      getSelection: () => selectionRef.current,
      deleteObject: (id: string) => deleteObject(doc, id),
    });
  }, [setCamera, doc]);

  // Navigation keyboard shortcuts (story 1)
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

  // Note keyboard shortcuts (story 2): Enter edits, Delete/Backspace deletes.
  // While a note is being edited these keys belong to the textarea.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId !== null) return;
      if (isTextEntryTarget(e.target)) return;

      if (e.key === 'Enter') {
        if (selectedId === null) return;
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId === null) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, editingId, doc, startEdit, select]);

  // A note removed from the document (by anyone) ends its interaction silently.
  useEffect(() => {
    if (selectedId !== null && !objects.some((note) => note.id === selectedId)) {
      select(null);
    }
  }, [objects, selectedId, select]);

  const createAtPoint = useCallback(
    (point: Point) => {
      const id = createSticky(doc, point);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Double-click on empty board space creates a note centred on the point.
  const handleEmptyDblClick = useCallback(
    (p: Point) => {
      createAtPoint(screenToWorld(cameraRef.current, p));
    },
    [createAtPoint],
  );

  // The Sticky note button creates a note in the middle of the visible area.
  const handleCreateSticky = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtPoint(screenToWorld(cameraRef.current, centre));
  }, [createAtPoint, viewport]);

  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  const handleDelete = useCallback(
    (id: string) => {
      deleteObject(doc, id);
      select(null);
    },
    [doc, select],
  );

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
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
      >
        {objects.map((note) => (
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
            onDelete={handleDelete}
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
