import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { registerTestHooks } from './canvas/testHooks';
import type { Size } from './canvas/camera';
import { screenToWorld, zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import type { StickySnapshot } from '../shared/board-model';

/** True when the key should go to a text field instead of the board. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Notes are rendered in id order and stacked with CSS z-index. Paint order is
 * then exactly the snapshot order (z, then id as the tie-break), but a note that
 * changes z is never re-inserted into the DOM - which would fire
 * lostpointercapture and kill a drag that has just raised itself.
 */
function byId(a: StickySnapshot, b: StickySnapshot): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

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
      getNotes: () => notes,
      getDoc: () => doc,
    });
  }, [setCamera, notes, doc]);

  // Keyboard shortcuts: Ctrl/Meta zoom, Enter edits the selected note,
  // Delete/Backspace removes it (never while its text is being edited).
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

      if (isEditableTarget(e.target)) return; // keys belong to the textarea

      if (e.key === 'Enter') {
        if (editingId !== null || selectedId === null) return;
        e.preventDefault();
        startEdit(selectedId);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editingId !== null || selectedId === null) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset, doc, selectedId, editingId, startEdit]);

  // A note can leave the document while still selected (bin button, or from
  // another client from story 3 on): never keep a dangling selection.
  useEffect(() => {
    if (selectedId === null) return;
    if (!notes.some((note) => note.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  /** Create a note centred on a screen point and start typing right away. */
  const createAtScreenPoint = useCallback(
    (screen: { x: number; y: number }) => {
      const id = createSticky(doc, screenToWorld(cameraRef.current, screen));
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const handleEmptyDblClick = useCallback(
    (world: { x: number; y: number }) => {
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const handleCreateSticky = useCallback(() => {
    // The centre of the visible board area, wherever the board is panned.
    const size = viewportRef.current;
    createAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createAtScreenPoint]);

  const handleEmptyClick = useCallback(() => {
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
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
      >
        {[...notes].sort(byId).map((note) => (
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
