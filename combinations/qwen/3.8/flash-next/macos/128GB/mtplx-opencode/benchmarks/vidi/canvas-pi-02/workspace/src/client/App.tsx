import { useCallback, useEffect, useRef } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import type { Camera, Point } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraContext, useCamera, useViewportSize } from './canvas/useCamera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installBoardTestHooks, removeBoardTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc, useBoardSnapshot } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';

/** Tags that own their own keyboard input, so the board must not steal it. */
const INPUT_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * True when the keystroke belongs to a text field. Both halves of the rule are
 * needed: `editingId` catches the note's own textarea, and the tag check
 * catches any other input (a future comment box, the browser's find bar) so a
 * Delete there never deletes a note.
 */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INPUT_TAGS.has(target.tagName.toLowerCase()) || target.isContentEditable;
}

/**
 * Top-level layout: a full-window board area, the sticky tools on the left,
 * the zoom controls bottom-right and the first-use hint near the bottom centre.
 *
 * App is where the three stores meet: the camera (useCamera), the board
 * document (useBoardDoc) and the selection (useSelection). Nothing here draws
 * a note; it decides what a gesture *means* and calls the model.
 */
export function App() {
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(boardAreaRef);
  const cameraApi = useCamera(viewport);
  const board = useBoardDoc();
  const notes = useBoardSnapshot(board);
  const selection = useSelection();

  // Listeners that are bound once read the live stores through these refs.
  const boardRef = useRef(board);
  boardRef.current = board;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cameraRef = useRef<{ camera: Camera }>(cameraApi);
  cameraRef.current = cameraApi;
  const apiRef = useRef(cameraApi);
  useEffect(() => {
    apiRef.current = cameraApi;
  });

  useEffect(() => {
    installBoardTestHooks(
      () => apiRef.current,
      () => boardRef.current?.doc ?? null,
    );
    return () => removeBoardTestHooks();
  }, []);

  /** Put a sticky at a world point and start typing straight away. */
  const createStickyAt = useCallback(
    (point: Point) => {
      const id = createSticky(boardRef.current.doc, point);
      if (!id) return;
      selection.startEdit(id);
    },
    [selection],
  );

  /** The toolbar button: a note in the middle of what I can see right now. */
  const createStickyInViewCentre = useCallback(() => {
    const camera = cameraRef.current.camera;
    const size = viewportRef.current;
    createStickyAt(
      screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }),
    );
  }, [createStickyAt]);

  const notesRef = useRef(notes);
  notesRef.current = notes;

  /** The board's own key handling, shared by mouse and keyboard users. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextInput(event.target)) return;
      const state = selection.current();
      // While a note is being edited every key belongs to the textarea.
      if (state.editingId !== null) return;
      const id = state.selectedId;
      if (id === null) return;

      if (event.key === 'Enter') {
        // A selected or Tab-focused note: start editing it.
        event.preventDefault();
        selection.startEdit(id);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(boardRef.current.doc, id);
        // Also true for a note that is already gone: the stale selection goes
        // away either way.
        selection.select(null);
      }
    };

    // The one window listener of the story: the board, not the note, owns the
    // keyboard, so a note does not have to be focused for Delete to work.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection]);

  const camera = cameraApi.camera;

  const handleSurfaceClick = useCallback(() => {
    // Clicking empty board space drops the selection and any open editor.
    selection.select(null);
  }, [selection]);

  const handleSurfaceDoubleClick = useCallback(
    (point: Point) => {
      createStickyAt(point);
    },
    [createStickyAt],
  );

  const selectNote = useCallback(
    (id: string | null) => {
      // A note that vanished mid-drag must not stay "selected": that would
      // leave the keyboard holding a stale id.
      if (id !== null && !notesRef.current.some((note) => note.id === id)) return;
      selection.select(id);
    },
    [selection],
  );

  const startEditNote = useCallback(
    (id: string) => {
      selection.startEdit(id);
    },
    [selection],
  );

  const endEditNote = useCallback(
    (next: 'selected' | 'unselected') => {
      selection.endEdit(next);
    },
    [selection],
  );

  const deleteNote = useCallback(
    (id: string) => {
      deleteObject(boardRef.current.doc, id);
      selection.select(null);
    },
    [selection],
  );

  return (
    <CameraContext.Provider value={cameraApi}>
      <div className="board-area" data-testid="board-area" ref={boardAreaRef}>
        <BoardViewport
          onSurfaceClick={handleSurfaceClick}
          onSurfaceDoubleClick={handleSurfaceDoubleClick}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={board.doc}
              zoom={camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selectNote}
              onStartEdit={startEditNote}
              onEndEdit={endEditNote}
              onDelete={deleteNote}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={createStickyInViewCentre} />
      </div>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={() => cameraApi.reset()}
      />
      <NavigationHint visible={!cameraApi.hasNavigated} />
    </CameraContext.Provider>
  );
}
