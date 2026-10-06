import { useCallback, useEffect } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useBoardCamera } from './canvas/CameraProvider';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { IS_TEST_MODE, registerTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';

export function App() {
  return (
    <CameraProvider>
      <Board />
    </CameraProvider>
  );
}

/** True when the keyboard belongs to a text field, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * The board: the document, the notes in it, this user's selection, and the keyboard and
 * toolbar commands that create, recolour and delete notes.
 */
function Board() {
  const { camera, size, getCamera, setCamera, hasNavigated, zoomStep, reset } =
    useBoardCamera();
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // A note deleted (by the bin button, a key, or another user later) is neither selected
  // nor edited any more; the stale ids are ignored rather than acted upon.
  const selected = notes.some((note) => note.id === selectedId);
  const editing = notes.some((note) => note.id === editingId);
  const selectedNoteId = selected ? selectedId : null;
  const editingNoteId = editing && selectedNoteId === editingId ? editingId : null;

  // ---- test-only handle (excluded from production builds) ----
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    registerTestHooks({
      getCamera,
      setCamera,
      getDoc: () => doc,
      getNotes: () => snapshot(doc),
    });
    return () => registerTestHooks(null);
  }, [doc, getCamera, setCamera]);

  /** Creates a note centred on a screen point and starts typing it. */
  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      const id = createSticky(doc, screenToWorld(getCamera(), point));
      if (!id) return;
      select(id);
      startEdit(id);
    },
    [doc, getCamera, select, startEdit],
  );

  /** The Sticky note button: a note in the middle of what the user can see. */
  const createAtViewportCentre = useCallback(() => {
    createAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createAtScreenPoint, size.height, size.width]);

  // ---- keyboard: Enter edits the selected note, Delete/Backspace removes it ----
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      // while a note's text is being edited the keys belong to the text: Delete and
      // Backspace edit characters and the note is never removed
      if (editingNoteId !== null || isTextEntry(event.target)) return;
      if (selectedNoteId === null) return; // Enter with nothing selected does nothing

      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(selectedNoteId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, selectedNoteId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedNoteId, editingNoteId, startEdit, select]);

  return (
    <>
      <BoardViewport
        onCreateAt={createAtScreenPoint}
        onClearSelection={() => {
          select(null);
        }}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedNoteId}
            editing={note.id === editingNoteId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} />
      <BoardChrome
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
        hintVisible={!hasNavigated}
      />
    </>
  );
}

/**
 * The on-screen navigation chrome from story 1, kept as its own component so the zoom
 * controls and the hint keep the props the design gives them.
 */
function BoardChrome(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
  hintVisible: boolean;
}) {
  return (
    <>
      <ZoomControls
        zoomPercent={props.zoomPercent}
        canZoomIn={props.canZoomIn}
        canZoomOut={props.canZoomOut}
        onZoomIn={props.onZoomIn}
        onZoomOut={props.onZoomOut}
        onReset={props.onReset}
      />
      <NavigationHint visible={props.hintVisible} />
    </>
  );
}
