import { useRef, useState, useEffect, useCallback } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { screenToWorld } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { setupTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { createSticky, deleteObject, setStickyColor } from '@shared/board-model';
import { newBoardId } from '@shared/board-id';
import { STICKY_SIZE_WORLD } from '@shared/config';
import type { Point } from './canvas/camera';

function getBoardIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  return match ? match[1] : null;
}

export function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Redirect / to /b/<newBoardId>
  useEffect(() => {
    if (window.location.pathname === '/') {
      const id = newBoardId();
      window.history.replaceState(null, '', `/b/${id}`);
    }
  }, []);

  const boardId = getBoardIdFromPath();

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Set up test hooks
  useEffect(() => {
    setupTestHooks(cam);
  }, [cam]);

  const editAllowed = canEdit(connectionState);

  // Create a sticky note at a world point
  const createStickyAt = useCallback((worldPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const id = createSticky(doc, worldPoint);
    if (id) {
      startEdit(id);
    }
  }, [doc, startEdit, connectionState]);

  // Handle double-click on empty board space
  const handleDoubleClickEmpty = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    createStickyAt(worldPoint);
  }, [cam.camera, createStickyAt, connectionState]);

  // Handle click on Sticky note toolbar button
  const handleCreateSticky = useCallback(() => {
    if (!canEdit(connectionState)) return;
    const centre: Point = { x: size.width / 2, y: size.height / 2 };
    const worldPoint = screenToWorld(cam.camera, centre);
    createStickyAt(worldPoint);
  }, [cam.camera, size, createStickyAt, connectionState]);

  // Handle clear selection (click on empty space)
  const handlePointerUpEmpty = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler for Enter, Delete, Backspace
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle keys when focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        if (canEdit(connectionState)) startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        if (canEdit(connectionState)) {
          deleteObject(doc, selectedId);
          select(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, doc, select, startEdit]);

  // Handle colour change from NoteToolbar
  const handleColorChange = useCallback((color: string) => {
    if (selectedId && canEdit(connectionState)) {
      setStickyColor(doc, selectedId, color);
    }
  }, [doc, selectedId, connectionState]);

  // Handle delete from NoteToolbar
  const handleDelete = useCallback(() => {
    if (selectedId && canEdit(connectionState)) {
      deleteObject(doc, selectedId);
      select(null);
    }
  }, [doc, selectedId, select, connectionState]);

  // Clear selection/editing if the note was deleted remotely
  useEffect(() => {
    if (selectedId && !objects.find(n => n.id === selectedId)) {
      select(null);
    }
  }, [objects, selectedId, select]);

  // Find the selected note for NoteToolbar positioning
  const selectedNote = objects.find(n => n.id === selectedId);

  // Compute screen position for the NoteToolbar
  let noteToolbarStyle: React.CSSProperties | null = null;
  if (selectedNote && !editingId) {
    const screenX = (selectedNote.x - cam.camera.x) * cam.camera.zoom;
    const screenY = (selectedNote.y - cam.camera.y) * cam.camera.zoom;
    const noteWidth = STICKY_SIZE_WORLD * cam.camera.zoom;
    noteToolbarStyle = {
      position: 'absolute',
      left: screenX + noteWidth / 2,
      top: screenY - 8,
      transform: 'translate(-50%, -100%)',
      zIndex: 1001,
    };
  }

  return (
    <div ref={viewportRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomAtPointer={cam.zoomAtPointer}
        zoomStep={cam.zoomStep}
        reset={cam.reset}
        isPanning={cam.isPanning}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onPointerUpEmpty={handlePointerUpEmpty}
      >
        {objects.map(note => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateSticky} disabled={!editAllowed} />
      {noteToolbarStyle && selectedNote && (
        <div style={noteToolbarStyle}>
          <NoteToolbar
            color={selectedNote.color}
            onColor={handleColorChange}
            onDelete={handleDelete}
          />
        </div>
      )}
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
