import { useCallback, useEffect, useRef, type JSX } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from '../canvas/camera';
import { CameraApiContext, useCamera, useViewportSize } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit as connectionAllowsEditing } from '../sync/connectBoard';
import { createSticky, deleteObject } from '../../shared/board-model';

const DELETE_KEYS = ['Delete', 'Backspace'];

/**
 * The board itself: everything stories 1–4 built, mounted on one board id that has
 * already been checked for (`BoardPage`, story 5).
 *
 * The id is a prop and never discovered here. Story 3 read it out of the address bar and
 * wrote one when the address did not have it, which was fine while an address *was* a
 * board; now a board is created by `POST /api/boards`, and a page that renders this
 * component has already been told the board exists. That is also why a mistyped link can
 * no longer leave an empty board behind.
 *
 * Everything a note does goes through `board-model`, so the same document can be synced
 * (story 3) and persisted (story 4) without touching any of this. Selection and editing
 * stay in here — local React state — which is why nobody else's screen reacts to what
 * this cursor is doing.
 */
export function Board({ boardId }: { boardId: string }): JSX.Element {
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;
  const { doc, notes, connection } = useBoardDoc(boardId);
  const selection = useSelection();
  // A board that could not be loaded is shown empty and refuses every edit (story 4);
  // no other connection state refuses anything.
  const canEdit = connectionAllowsEditing(connection);

  // Handlers that run long after a render read the latest values through refs.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  /**
   * Create a note centred on a screen point: `createSticky` stores the top-left, so it
   * subtracts half a note itself. The new note is on top and is being typed into right
   * away, wherever the board has been panned.
   */
  const createAtScreenPoint = useCallback(
    (screenPoint: Point): void => {
      if (!canEdit) return; // no edits on a board that failed to load
      const world = screenToWorld(cameraRef.current, screenPoint);
      const id = createSticky(doc, world);
      if (id === false) return;
      selectionRef.current.startEdit(id);
    },
    [doc, canEdit],
  );

  /** The Sticky note button: the centre of the visible board area. */
  const createAtViewportCentre = useCallback((): void => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);

  // Enter edits the selected note, Delete/Backspace deletes it — never while typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      const { selectedId, editingId } = selectionRef.current;
      if (editingId !== null) return; // the keys edit text, not the note
      if (DELETE_KEYS.includes(event.key)) {
        if (!selectedId || !canEdit) return;
        event.preventDefault();
        deleteObject(doc, selectedId);
        selectionRef.current.select(null);
        return;
      }
      if (event.key === 'Enter') {
        if (!selectedId || !canEdit) return; // Enter with nothing selected does nothing (TC-36)
        if (!notesRef.current.some((note) => note.id === selectedId)) return;
        event.preventDefault();
        selectionRef.current.startEdit(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, canEdit]);

  // A note can leave the document while it is selected (deleted by anyone, from any
  // client), in which case the local selection is dropped with it.
  useEffect(() => {
    const { selectedId, editingId } = selection;
    if (selectedId === null && editingId === null) return;
    const present = new Set(notes.map((note) => note.id));
    const stale =
      (selectedId !== null && !present.has(selectedId)) ||
      (editingId !== null && !present.has(editingId));
    if (stale) selection.select(null);
  }, [notes, selection]);

  return (
    <CameraApiContext.Provider value={cameraApi}>
      <main className="vidi6-app" data-testid="app">
        <BoardViewport
          onCreateStickyAt={createAtScreenPoint}
          onEmptyClick={() => {
            selectionRef.current.select(null);
          }}
        >
          {notes.map((note) => (
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
              readOnly={!canEdit}
            />
          ))}
        </BoardViewport>
        <ConnectionStatus state={connection} />
        <Toolbar onCreateSticky={createAtViewportCentre} disabled={!canEdit} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => cameraApi.zoomStep('in')}
          onZoomOut={() => cameraApi.zoomStep('out')}
          onReset={cameraApi.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </main>
    </CameraApiContext.Provider>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}
