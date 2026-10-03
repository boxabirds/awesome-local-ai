/**
 * Top-level layout: the full-window board plus its fixed overlays.
 *
 * `CameraProvider` owns the camera (`useCamera`); `BoardLayout` reads it and
 * wires it to the viewport, the zoom controls and the navigation hint, and adds
 * the collaborative layer: the shared document (`useBoardDoc`), the local
 * selection (`useSelection`) and the sticky notes drawn from the snapshot.
 *
 * Two things are deliberately not in React state and not in the document:
 * selection/editing (local only, see `useSelection`) and the camera (story 1).
 */
import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useCameraContext } from './canvas/CameraContext';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { ConnectionStatus } from './sync/ConnectionStatus';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { useWindowSize } from './canvas/useCamera';
import { StickyNote } from './objects/StickyNote';

/**
 * Whether the focused thing takes the key for itself: a field you type into,
 * or a control that acts on Enter. Pressing Enter on the delete bin has to press
 * the bin, not start editing the note behind it.
 */
function takesItsOwnKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  ) {
    return true;
  }
  return target.tagName === 'BUTTON' || target.tagName === 'A';
}

export interface AppProps {
  /** Bring your own document; the default is a fresh one (tests pass one). */
  doc?: Y.Doc;
  /**
   * The board this page is showing, from `/b/:boardId`. Without it the board is
   * local only: no room is opened, and nothing is reported about a connection.
   */
  boardId?: string;
}

/**
 * The board this address names, or `null` when it names none: anything that is
 * not `/b/<boardId>`, and `/b/<something that is not an id>`.
 *
 * Validation is `isValidBoardId`, the same rule the Worker applies to
 * `/api/rooms/:boardId`, so a page and its room never disagree about whether an
 * address can name a board. Saying so on screen is story 5's page; here it simply
 * means *no room*, which is the honest reading of an address that cannot have one.
 */
export function boardIdFromPath(pathname: string): string | null {
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const candidate = match[1];
  return candidate !== undefined && isValidBoardId(candidate) ? candidate : null;
}

function BoardLayout({ doc, boardId }: AppProps) {
  const nav = useCameraContext();
  const { camera } = nav;
  const viewport = useWindowSize();
  const board = useBoardDoc(boardId, doc);
  const selection = useSelection();
  const { notes } = board;

  // Latest values for listeners that are attached once.
  const latestRef = useRef({ camera, selection, doc: board.doc });
  latestRef.current = { camera, selection, doc: board.doc };

  // A note that disappears stops being selected *and* stops being edited, so the
  // toolbars and the keyboard never point at a note that is not there. With a room
  // attached, a note can disappear without this keyboard touching it: somebody else
  // deleted it while this person was typing in it or dragging it, and the editor
  // closes on the deletion, not on a keystroke.
  useEffect(() => {
    const { selectedId, editingId } = selection;
    if (selectedId === null && editingId === null) return;
    const stillThere = (id: string | null) => id !== null && notes.some((note) => note.id === id);
    if (stillThere(selectedId) && stillThere(editingId)) return;
    if (editingId !== null && !stillThere(editingId)) selection.endEdit('unselected');
    else if (!stillThere(selectedId)) selection.select(null);
  }, [notes, selection]);

  // Enter edits the selected note; Delete/Backspace removes it. While a note is
  // being edited these keys belong to the textarea, so nothing happens here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (takesItsOwnKeys(event.target)) return;
      const { selection: sel, doc: document } = latestRef.current;
      if (sel.editingId !== null) return;
      const id = sel.selectedId;
      if (id === null) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(document, id);
        sel.select(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        sel.startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Put a note on the board centred on a world point and start typing it. */
  const createAt = useCallback(
    (point: Point) => {
      const id = createSticky(latestRef.current.doc, point);
      if (!id) return;
      selection.startEdit(id);
    },
    [selection],
  );

  const createAtCentre = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAt, viewport.height, viewport.width]);

  return (
    <div className="app">
      <ConnectionStatus state={board.connectionState} />
      <Toolbar onCreateSticky={createAtCentre} />
      <BoardViewport
        onEmptyDoubleClick={(point) => {
          createAt(screenToWorld(camera, point));
        }}
        onEmptyClick={() => {
          selection.select(null);
        }}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={board.doc}
            zoom={camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          nav.zoomStep('in');
        }}
        onZoomOut={() => {
          nav.zoomStep('out');
        }}
        onReset={nav.reset}
      />
      <NavigationHint visible={!nav.hasNavigated} />
    </div>
  );
}

export function App({ doc, boardId }: AppProps = {}) {
  const fromAddress = boardIdFromPath(window.location.pathname);
  return (
    <CameraProvider>
      <BoardLayout boardId={boardId ?? fromAddress ?? undefined} doc={doc} />
    </CameraProvider>
  );
}

/** The address of a board nobody has opened yet; story 5 gives it a Share button. */
export function newBoardPath(): string {
  return `/b/${newBoardId()}`;
}
