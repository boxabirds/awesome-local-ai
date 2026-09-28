import { useCallback, useEffect, useMemo, useRef } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardCameraProvider, useBoardCamera } from './canvas/cameraContext';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { installBoardTestHook } from './canvas/testHooks';

export function App() {
  return (
    <BoardCameraProvider>
      <Board />
    </BoardCameraProvider>
  );
}

/** True when the key belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The board and everything on it: sticky notes live in the Y.Doc, selection
 * and editing are local, and the fixed chrome sits outside the transformed
 * world layer.
 */
function Board() {
  const board = useBoardCamera();
  const { camera } = board;
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();

  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      selection.startEdit(id);
    },
    [camera, doc, selection],
  );

  /** Sticky note button: a note in the middle of the visible board area. */
  const createAtCentre = useCallback(() => {
    createAtScreenPoint({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
  }, [createAtScreenPoint]);

  // Keyboard: Enter edits the selected note, Delete/Backspace removes it.
  // While a note's text is being edited (or focus is in any text field) the
  // keys belong to the text, so they are ignored here.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId !== null || isTextEntry(e.target)) return;
      if (e.key === 'Enter') {
        if (!selection.selectedId) return;
        e.preventDefault();
        selection.startEdit(selection.selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection.selectedId) return;
        e.preventDefault();
        deleteObject(doc, selection.selectedId);
        selection.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection]);

  const selectedNote = notes.find((note) => note.id === selection.selectedId) ?? null;

  // Paint order comes from each note's `zIndex` (its `z` in the document), not
  // from the order of the children: a stable element order means a
  // `bringToFront` in the middle of a drag cannot move the note's DOM node,
  // and a browser treats a move as a removal, which releases pointer capture
  // and would end the drag early.
  const stacked = useMemo(
    () => [...notes].sort((a, b) => (a.id < b.id ? -1 : 1)),
    [notes],
  );

  // Test-only window.__vidi6.getNotes()/deleteNote() (dropped from production
  // builds): tests read the document and delete a note under an in-flight
  // interaction, which no user gesture can do.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(
    () =>
      installBoardTestHook({
        getNotes: () => notesRef.current,
        deleteNote: (id) => deleteObject(doc, id),
      }),
    [doc],
  );

  // A note deleted by anyone while selected (or being edited) leaves both
  // states behind; its own components stop when it disappears from the
  // snapshot.
  useEffect(() => {
    if (selection.selectedId && !selectedNote) selection.select(null);
  }, [selection, selectedNote]);

  return (
    <>
      <BoardViewport
        onCreateAtPoint={createAtScreenPoint}
        onClearSelection={() => selection.select(null)}
      >
        {stacked.map((note) => (
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

      <Toolbar onCreateSticky={createAtCentre} />

      <BoardChrome />
    </>
  );
}

/** Fixed-position chrome wired to the board camera. */
function BoardChrome() {
  const board = useBoardCamera();
  const { camera } = board;
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => board.zoomStep('in')}
        onZoomOut={() => board.zoomStep('out')}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
    </>
  );
}
