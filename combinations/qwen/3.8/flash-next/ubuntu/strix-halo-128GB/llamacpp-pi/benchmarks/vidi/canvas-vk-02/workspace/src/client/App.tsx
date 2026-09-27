import { useCallback, useEffect, useRef, useState } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { CameraContext, useCamera } from './canvas/useCamera';
import { useTestHooks } from './canvas/testHooks';
import { useViewportSize } from './canvas/useViewportSize';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import type { Point } from './canvas/camera';

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/**
 * The board this tab is on, taken from the address (`/b/<boardId>`). Story 5
 * replaces "invent an address when there is none" with server-side creation;
 * until then opening the site root starts a fresh board at a fresh address.
 */
function useBoardId(): string {
  const [boardId] = useState<string>(
    () => BOARD_PATH.exec(window.location.pathname)?.[1] ?? newBoardId(),
  );

  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '');
    if (path !== `/b/${boardId}`) window.history.replaceState(null, '', `/b/${boardId}`);
  }, [boardId]);

  return boardId;
}

/**
 * Top level: one board, one camera, one document and one local selection.
 *
 * The camera is owned here so the zoom controls and navigation hint read from
 * it; the notes live in the document (story 2 keeps it in memory only); the
 * selection/editing state is per-client and never touches the document.
 */
export default function App() {
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(boardAreaRef);
  const cameraApi = useCamera(viewport);

  const { camera, hasNavigated, zoomStep, reset } = cameraApi;
  const onZoomIn = useCallback(() => zoomStep('in'), [zoomStep]);
  const onZoomOut = useCallback(() => zoomStep('out'), [zoomStep]);

  const boardId = useBoardId();
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  useTestHooks(cameraApi, connectionState);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Create a note centred on a world point, then select and edit it.
  const createAtWorld = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id !== '') startEdit(id);
    },
    [doc, startEdit],
  );

  // Double-click on empty board: centred on the clicked point.
  const handleEmptyDblClick = useCallback(
    (point: Point) => {
      createAtWorld(screenToWorld(camera, point));
    },
    [camera, createAtWorld],
  );

  // Toolbar button: centred in the visible board area, so it works panned far away.
  const handleCreateSticky = useCallback(() => {
    createAtWorld(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAtWorld, viewport.width, viewport.height]);

  const handleEmptyClick = useCallback(() => select(null), [select]);

  // Board-wide keyboard: Enter starts editing the selected note; Delete /
  // Backspace deletes it. Both are ignored while editing text (the keys then
  // belong to the textarea) or while focus is in any field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName ?? '').toUpperCase();
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable === true;
      if (editingId !== null || inField) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId === null) return;
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      } else if (event.key === 'Enter') {
        if (selectedId === null) return;
        event.preventDefault();
        startEdit(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, select, startEdit]);

  // A note removed from the document (by any means) drops out of selection and
  // editing too, so a stale id can never leave a dangling outline or editor.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
    if (editingId !== null && !notes.some((n) => n.id === editingId)) endEdit('unselected');
  }, [notes, selectedId, editingId, select, endEdit]);

  return (
    <CameraContext.Provider value={cameraApi}>
      <div className="board-area" data-testid="board-area" ref={boardAreaRef}>
        <BoardViewport
          onEmptyDblClick={handleEmptyDblClick}
          onEmptyClick={handleEmptyClick}
        >
          {notes.map((note) => (
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
      </div>
      <Toolbar onCreateSticky={handleCreateSticky} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </CameraContext.Provider>
  );
}
