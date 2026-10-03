// Top-level layout: full-window board viewport, toolbars, sticky notes,
// zoom controls and first-use navigation hint.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardViewport, CameraContext, useCameraContext } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { installTestHooks } from './canvas/testHooks';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { createSticky, deleteObject } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';

/**
 * Board id from the address (`/b/<boardId>`). A missing or malformed id
 * means a fresh board: generate one and replace the address so the URL is
 * always shareable.
 */
function useBoardId(): string {
  const [boardId] = useState(() => {
    const match = /^\/b\/([^/]+)$/.exec(window.location.pathname);
    if (match && isValidBoardId(match[1])) return match[1];
    const id = newBoardId();
    window.history.replaceState(null, '', `/b/${id}`);
    return id;
  });
  return boardId;
}

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useViewportSize(rootRef);
  const cameraApi = useCamera(size);
  const { camera, hasNavigated } = cameraApi;
  const setCamera = cameraApi.setCamera;

  const boardId = useBoardId();
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);

  // Test-only `window.__vidi6` hook (test mode only, see testHooks.ts).
  useEffect(() => {
    installTestHooks(setCamera, () => boardId, () => connectionState);
  }, [setCamera, boardId, connectionState]);

  // Create a sticky note at a screen point (double-click on empty space)
  const handleDblClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      const world = screenToWorld(camera, screenPoint);
      const id = createSticky(doc, world);
      if (id) {
        selection.startEdit(id);
      }
    },
    [camera, doc, selection],
  );

  // Create a sticky note at the centre of the viewport (toolbar button)
  const handleCreateSticky = useCallback(() => {
    const centre = { x: size.width / 2, y: size.height / 2 };
    const world = screenToWorld(camera, centre);
    const id = createSticky(doc, world);
    if (id) {
      selection.startEdit(id);
    }
  }, [camera, doc, selection, size]);

  // Clear selection on empty board click
  const handleClickEmpty = useCallback(() => {
    selection.select(null);
  }, [selection]);

  // Keyboard handler: Enter to edit, Delete/Backspace to delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

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
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection.selectedId, selection.editingId, selection, doc]);

  return (
    <CameraContext.Provider value={cameraApi}>
      <div ref={rootRef} className="app-root" data-testid="app-root">
        <BoardViewport
          onDblClickEmpty={handleDblClickEmpty}
          onClickEmpty={handleClickEmpty}
        >
          {objects.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selection.select}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={handleCreateSticky} />
        <ConnectionStatus state={connectionState} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => cameraApi.zoomStep('in')}
          onZoomOut={() => cameraApi.zoomStep('out')}
          onReset={cameraApi.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
