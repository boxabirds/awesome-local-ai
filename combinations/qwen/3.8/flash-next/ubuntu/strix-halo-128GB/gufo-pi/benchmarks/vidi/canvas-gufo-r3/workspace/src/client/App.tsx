import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Point, Size, canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '@client/canvas/camera';
import { useCamera } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { NavigationHint } from '@client/canvas/NavigationHint';
import { setupTestHooks } from '@client/canvas/testHooks';
import { useBoardDoc } from '@client/board/useBoardDoc';
import { useSelection } from '@client/board/useSelection';
import { Toolbar } from '@client/board/Toolbar';
import { StickyNote } from '@client/objects/StickyNote';
import { createSticky, deleteObject } from '@shared/board-model';

export function App() {
  return <Board />;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function Board() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, wheel, gestureZoom, zoomStep, reset, setCamera } = cameraState;

  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  // Keep the latest selection reachable from stable window handlers.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setViewportSize({ width, height });
      }
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, []);

  // Test hooks
  useEffect(() => {
    setupTestHooks(setCamera, () => cameraRef.current);
  }, [setCamera]);

  // Board keyboard shortcuts (zoom)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomStep, reset]);

  // Note keyboard shortcuts: Enter starts editing the selected note;
  // Delete/Backspace removes it. Ignored while editing text or typing in a field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { selectedId: sel, editingId: ed } = selectionRef.current;
      if (e.key === 'Enter') {
        if (ed !== null || sel === null) return;
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        startEdit(sel);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ed !== null || sel === null) return;
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        deleteObject(doc, sel);
        select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, startEdit, select]);

  // If the selected or edited note disappears (deleted via its toolbar, or by another
  // client from story 3), drop the stale selection.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) {
      select(null);
    }
  }, [notes, selectedId, select]);

  const createAtWorldCentre = useCallback(() => {
    const cam = cameraRef.current;
    const centre: Point = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    if (id) startEdit(id);
  }, [doc, startEdit, viewportSize.width, viewportSize.height]);

  const handleDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Stable DOM order (by id) so a stacking change never moves a node in the DOM —
  // moving the element under the pointer would drop pointer capture mid-drag.
  // Stacking is expressed with CSS z-index from the model's z value.
  const renderOrder = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <BoardViewport
        camera={camera}
        beginPan={cameraState.beginPan}
        panMove={cameraState.panMove}
        endPan={cameraState.endPan}
        wheel={wheel}
        gestureZoom={gestureZoom}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onClickEmpty={() => select(null)}
      >
        {renderOrder.map((note) => (
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
      <Toolbar onCreateSticky={createAtWorldCentre} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
