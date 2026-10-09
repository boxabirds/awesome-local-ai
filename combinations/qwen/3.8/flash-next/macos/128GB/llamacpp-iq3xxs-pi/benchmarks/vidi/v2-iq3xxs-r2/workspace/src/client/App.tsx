import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { CameraApiContext, useCamera, useViewportSize } from './canvas/useCamera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit as connectionAllowsEditing } from './sync/connectBoard';
import { createSticky, deleteObject } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';

const DELETE_KEYS = ['Delete', 'Backspace'];

/** The two addresses for a board: in the path, and in the hash (the one we hand out). */
const BOARD_IN_PATH = /^\/b\/([^/]+)$/;
const BOARD_IN_HASH = /^#\/b\/([^/]+)$/;

/**
 * Which board this page is on.
 *
 * `/b/<id>` and `/#/b/<id>` both work — the Worker answers either with the app — and an
 * address without a usable board id gets a new one written into the URL, so opening the
 * app straight from the root is still a board, and reloading it is the same board.
 */
function boardIdFromLocation(): string {
  const { pathname, hash } = window.location;
  for (const candidate of [BOARD_IN_HASH.exec(hash)?.[1], BOARD_IN_PATH.exec(pathname)?.[1]]) {
    if (candidate !== undefined && isValidBoardId(candidate)) return candidate;
  }
  const fresh = newBoardId();
  window.history.replaceState(null, '', `#/b/${fresh}`);
  return fresh;
}

/** The link to hand somebody so they land on this very board. */
function boardLink(boardId: string): string {
  return `${window.location.origin}/#/b/${boardId}`;
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

/**
 * Full-window board (story 1) plus the sticky notes of story 2, on one board address
 * (story 3): the Yjs document, this client's selection, the toolbars, the keyboard
 * shortcuts and the connection status.
 *
 * Everything a note does goes through `board-model`, so the same document can be synced
 * (story 3) and persisted (story 4) without touching any of this. Selection and editing
 * stay in here — local React state — which is why nobody else's screen reacts to what
 * this cursor is doing.
 */
export function App(): JSX.Element {
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;
  // The board is chosen once: a page is one board, and a different board is a different
  // page (a new link), not a re-render.
  const [boardId] = useState<string>(boardIdFromLocation);
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
        <Toolbar
          onCreateSticky={createAtViewportCentre}
          shareUrl={boardLink(boardId)}
          disabled={!canEdit}
        />
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
