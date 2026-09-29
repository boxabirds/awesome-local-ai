import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Point, Size, canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '@client/canvas/camera';
import { useCamera } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { NavigationHint } from '@client/canvas/NavigationHint';
import { setupTestHooks, setTestConnectionState } from '@client/canvas/testHooks';
import { useBoardDoc } from '@client/board/useBoardDoc';
import { useSelection } from '@client/board/useSelection';
import { Toolbar } from '@client/board/Toolbar';
import { StickyNote } from '@client/objects/StickyNote';
import { ConnectionStatus } from '@client/sync/ConnectionStatus';
import { canEdit } from '@client/sync/connectBoard';
import { createSticky, deleteObject } from '@shared/board-model';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, wheel, gestureZoom, zoomStep, reset, setCamera } = cameraState;

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit, prune } = selection;

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

  useEffect(() => {
    setTestConnectionState(connectionState);
  }, [connectionState]);

  // Board keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (!canEdit(connectionState)) return;
          const { selectedId: sel, editingId: ed } = selectionRef.current;
          if (ed !== null || sel === null) return;
          if (isTextInputTarget(e.target)) return;
          e.preventDefault();
          deleteObject(doc, sel);
          select(null);
        }
        if (e.key === 'Enter') {
          if (!canEdit(connectionState)) return;
          const { selectedId: sel, editingId: ed } = selectionRef.current;
          if (ed !== null || sel === null) return;
          if (isTextInputTarget(e.target)) return;
          e.preventDefault();
          startEdit(sel);
        }
        return;
      }
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
  }, [doc, startEdit, select, zoomStep, reset, connectionState]);

  // Prune stale selection
  useEffect(() => {
    const present = new Set(notes.map((n) => n.id));
    prune((id) => present.has(id));
  }, [notes, prune]);

  const createAtWorldCentre = useCallback(() => {
    if (!canEdit(connectionState)) return;
    const cam = cameraRef.current;
    const centre: Point = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    if (id) startEdit(id);
  }, [doc, startEdit, viewportSize.width, viewportSize.height, connectionState]);

  const handleDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      if (!canEdit(connectionState)) return;
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit, connectionState],
  );

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
            readOnly={!canEdit(connectionState)}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtWorldCentre} disabled={!canEdit(connectionState)} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
  );
}
