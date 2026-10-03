import { useLayoutEffect, useRef, useState, useCallback, useEffect } from 'react';
import type { JSX } from 'react';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from './canvas/camera';
import type { Size } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { newBoardId, BOARD_ID_PATTERN } from '../shared/board-id';

/**
 * Read the board id from `/b/:boardId`. Returns null for `/` (which
 * redirects to a fresh board id for now — server-side creation arrives in
 * story 5) and for malformed ids (which are redirected to a fresh board).
 */
function boardIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/b\/([^/]+)\/?$/);
  if (!match) return null;
  return BOARD_ID_PATTERN.test(match[1]) ? match[1] : null;
}

function resolveBoardId(): string {
  const id = boardIdFromPath(window.location.pathname);
  if (id) return id;
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';

const INITIAL_SIZE: Size = { width: 0, height: 0 };

export function App(): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(INITIAL_SIZE);

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const controls = useCamera(size);
  const boardId = useRef<string>(resolveBoardId()).current;
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Publish the mapped connection state to the test hook (test builds only).
  useEffect(() => {
    window.__vidi6?.setConnectionState(connectionState);
  }, [connectionState]);

  // Delete during edit: when a selected/being-edited note disappears (e.g.
  // deleted by someone else), end the selection and editing without error.
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) {
      select(null);
    }
  }, [notes, selectedId, select]);

  // Create a sticky note at a screen point
  const handleCreateAtScreenPoint = useCallback(
    (screenPoint: { x: number; y: number }) => {
      const worldPoint = screenToWorld(controls.camera, screenPoint);
      const id = createSticky(doc, worldPoint);
      startEdit(id);
    },
    [doc, controls.camera, startEdit],
  );

  // Create from toolbar button (centre of viewport)
  const handleCreateSticky = useCallback(() => {
    const centre = { x: size.width / 2, y: size.height / 2 };
    handleCreateAtScreenPoint(centre);
  }, [size, handleCreateAtScreenPoint]);

  // Double-click on empty board space
  const handleDblClickEmpty = useCallback(
    (point: { x: number; y: number }) => {
      handleCreateAtScreenPoint(point);
    },
    [handleCreateAtScreenPoint],
  );

  // Click on empty board space → clear selection
  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler: Enter to edit, Delete/Backspace to delete
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
    <div ref={shellRef} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <BoardViewport
        controls={controls}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={controls.camera.zoom}
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
        zoomPercent={zoomPercent(controls.camera)}
        canZoomIn={canZoomIn(controls.camera)}
        canZoomOut={canZoomOut(controls.camera)}
        onZoomIn={() => controls.zoomStep('in')}
        onZoomOut={() => controls.zoomStep('out')}
        onReset={controls.reset}
      />
      <NavigationHint visible={!controls.hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
  );
}
