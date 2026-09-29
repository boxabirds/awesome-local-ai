import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from './canvas/camera';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { TEST_MODE } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { isTextEntryTarget, useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { createSticky, deleteObject, type StickySnapshot } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';

/**
 * Extract board id from the URL path `/b/:boardId`, or redirect to a new board.
 */
function useBoardId(): string {
  const [boardId, setBoardId] = useState(() => {
    const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
    return match ? match[1] : '';
  });

  useEffect(() => {
    if (boardId) return;
    // Redirect / to /b/<newBoardId()>
    const id = newBoardId();
    window.history.replaceState(null, '', `/b/${id}`);
    setBoardId(id);
  }, [boardId]);

  return boardId;
}

/**
 * The board: an infinite canvas (story 1) holding sticky notes (story 2),
 * shared live with others (story 3).
 *
 * The camera lives here so the viewport, the zoom controls and the navigation
 * hint share one camera; the document and the selection live here too, because
 * the toolbar, the notes and the keyboard shortcuts all act on them.
 */
export function App() {
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;
  const boardId = useBoardId();
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection();
  const editing = canEdit(connectionState);

  /** Latest camera, readable synchronously inside event handlers. */
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  /**
   * Create a note centred on a screen point of the board area (a double-click),
   * and start typing straight away.
   */
  const createAtScreenPoint = useCallback(
    (screen: Point) => {
      if (!editing) return;
      const world = screenToWorld(cameraRef.current, screen);
      const id = createSticky(doc, world);
      if (id !== '') selection.startEdit(id);
    },
    [doc, selection, editing],
  );

  /** Create a note in the middle of what the user can see, wherever they panned. */
  const createAtCentre = useCallback(() => {
    if (!editing) return;
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.height, viewport.width, editing]);

  // Keyboard: Enter edits the selected note, Delete/Backspace removes it. While
  // a note is being edited - or while focus is in any field - these keys belong
  // to the text, so the note is never deleted from under the cursor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (selection.editingId !== null || isTextEntryTarget(event.target)) return;
      const selectedId = selection.selectedId;
      if (selectedId === null) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        selection.startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, selectedId);
        selection.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection]);

  // A note can also disappear from under the selection (story 3 removes notes
  // somebody else deleted), so the selection never points at nothing.
  useEffect(() => {
    const focused = selection.editingId ?? selection.selectedId;
    if (focused === null) return;
    if (!notes.some((note) => note.id === focused)) selection.select(null);
  }, [notes, selection]);

  // Test-only: hand the board document to the test suites (component tests make
  // model calls directly, for example deleting a note mid-drag).
  useEffect(() => {
    const hooks = TEST_MODE ? window.__vidi6 : undefined;
    if (!hooks) return undefined;
    const prevGetDoc = hooks.getDoc;
    const prevGetNoteCount = hooks.getNoteCount;
    const prevAddRandomNotes = hooks.addRandomNotes;
    hooks.getDoc = () => doc;
    hooks.getNoteCount = () => notes.length;
    hooks.addRandomNotes = (n: number) => {
      for (let i = 0; i < n; i++) {
        createSticky(doc, { x: (i % 50) * 220, y: Math.floor(i / 50) * 220 });
      }
    };
    return () => {
      hooks.getDoc = prevGetDoc;
      hooks.getNoteCount = prevGetNoteCount;
      hooks.addRandomNotes = prevAddRandomNotes;
    };
  }, [doc, notes.length]);

  /**
   * Notes are painted by CSS `z-index`, and rendered in a stable order. Sorting
   * the elements themselves would look identical - until a drag raises a note:
   * moving the element under the pointer drops its pointer capture and the drag
   * dies mid-gesture. Ordering by id keeps every node where it is.
   */
  const painted: StickySnapshot[] = useMemo(() => [...notes].sort(byId), [notes]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cameraApi}
        onEmptyClick={() => selection.select(null)}
        onEmptyDblClick={createAtScreenPoint}
      >
        {painted.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selection.selectedId}
            editing={note.id === selection.editingId}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCentre} disabled={!editing} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={cameraApi.reset}
      />
      {/* The first-use hint is for an empty board; once there are notes, the
          user has clearly started working. */}
      <NavigationHint visible={!hasNavigated && notes.length === 0} />
    </>
  );
}

/** A stable order for rendered notes: by id, so raising one moves nothing. */
function byId(a: StickySnapshot, b: StickySnapshot): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
