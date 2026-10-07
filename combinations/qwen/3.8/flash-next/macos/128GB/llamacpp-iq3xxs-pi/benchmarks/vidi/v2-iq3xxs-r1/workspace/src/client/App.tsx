import { useCallback, useEffect, useRef } from 'react';
import {
  BoardCameraProvider,
  BoardViewport,
  useBoardCamera,
} from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import {
  canZoomIn as camCanZoomIn,
  canZoomOut as camCanZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { patchTestHook, unpatchTestHook } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';

function ZoomControlsConnector() {
  const { camera, zoomStep, reset } = useBoardCamera();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={camCanZoomIn(camera)}
      canZoomOut={camCanZoomOut(camera)}
      onZoomIn={() => zoomStep('in')}
      onZoomOut={() => zoomStep('out')}
      onReset={reset}
    />
  );
}

function NavigationHintConnector() {
  const { hasNavigated } = useBoardCamera();
  return <NavigationHint visible={!hasNavigated} />;
}

/** True when the keyboard belongs to a text field, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The board: the document, the local selection, the object layer inside the
 * transformed world, the toolbars outside it, and the board-level keyboard.
 */
function Board() {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const { camera, viewport } = useBoardCamera();
  const { select, startEdit, endEdit, selectedId, editingId } = selection;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // A note that is gone (deleted here or, later, by somebody else) cannot stay
  // selected, and its toolbar must disappear with it.
  useEffect(() => {
    if (!selectedId) return;
    if (!notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  /** Create a note centred on a screen-space point, and start typing it. */
  const createAtScreenPoint = useCallback(
    (point: Point) => {
      const world = screenToWorld(camera, point);
      const id = createSticky(doc, world);
      if (id) startEdit(id); // yellow, on top, editing active
    },
    [camera, doc, startEdit],
  );

  const onCreateSticky = useCallback(
    () => createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 }),
    [createAtScreenPoint, viewport],
  );

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // While a note is being edited (or any text field has focus) the keys
      // belong to the text: Backspace and Delete must never remove the note.
      if (isTextEntry(event.target) || selectionRef.current.editingId) return;
      const id = selectionRef.current.selectedId;
      if (!id) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, id);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, select, startEdit]);

  // --------------------------------------------------- test-only inspection
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    patchTestHook({
      getDoc: () => doc,
      getSnapshot: () => snapshot(doc),
      getSelection: () => ({
        selectedId: selectionRef.current.selectedId,
        editingId: selectionRef.current.editingId,
      }),
    });
    return () => unpatchTestHook(['getDoc', 'getSnapshot', 'getSelection']);
  }, [doc]);

  const onSelect = useCallback((id: string) => select(id), [select]);
  const onStartEdit = useCallback((id: string) => startEdit(id), [startEdit]);
  const onEndEdit = useCallback((next: 'selected' | 'unselected') => endEdit(next), [endEdit]);

  return (
    <>
      <BoardViewport
        onCreateStickyAt={createAtScreenPoint}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={onSelect}
            onStartEdit={onStartEdit}
            onEndEdit={onEndEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
    </>
  );
}

export function App() {
  return (
    <BoardCameraProvider>
      <Board />
      <ZoomControlsConnector />
      <NavigationHintConnector />
    </BoardCameraProvider>
  );
}
