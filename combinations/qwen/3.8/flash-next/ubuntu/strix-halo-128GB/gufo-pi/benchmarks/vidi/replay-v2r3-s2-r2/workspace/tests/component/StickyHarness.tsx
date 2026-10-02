import React, { useEffect, useCallback, useState } from 'react';
import { useCamera } from '../../src/client/canvas/useCamera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';
import type { Size, Camera } from '../../src/client/canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from '../../src/client/canvas/camera';
import { createSticky, deleteObject, type StickySnapshot } from '../../src/shared/board-model';
import type * as Y from 'yjs';

function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

export interface HarnessHandle {
  doc: Y.Doc;
  getNotes(): readonly StickySnapshot[];
  getCamera(): Camera;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
  getSelectedId(): string | null;
  getEditingId(): string | null;
}

declare global {
  interface Window {
    __harness?: HarnessHandle;
  }
}

/**
 * Component-test harness that wires the same pieces as App.tsx (viewport, doc,
 * selection, toolbars, note keyboard shortcuts) but with a fixed viewport size
 * and a handle on `window.__harness` for creating notes and reading state.
 */
export function StickyHarness({ viewport = { width: 1280, height: 800 } }: { viewport?: Size }) {
  const cam = useCamera(viewport);
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  useEffect(() => {
    window.__harness = {
      doc,
      getNotes: () => notes,
      getCamera: () => cam.camera,
      select,
      startEdit,
      endEdit,
      getSelectedId: () => selectedId,
      getEditingId: () => editingId,
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId !== null) return;
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

  // Clear selection when the selected note disappears.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  const createAndEdit = useCallback(
    (worldPoint: { x: number; y: number }) => {
      const id = createSticky(doc, worldPoint);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const handleCreateAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => createAndEdit(screenToWorld(cam.camera, point)),
    [cam.camera, createAndEdit],
  );

  const handleCreateSticky = useCallback(() => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    createAndEdit(screenToWorld(cam.camera, centre));
  }, [cam.camera, viewport, createAndEdit]);

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        onBeginPan={cam.beginPan}
        onPanMove={cam.panMove}
        onEndPan={cam.endPan}
        onWheel={cam.wheel}
        onGestureZoom={cam.gestureZoom}
        onCreateAtScreenPoint={handleCreateAtScreenPoint}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
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
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
    </>
  );
}
