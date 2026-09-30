// Top-level layout: the board fills the window, the tools are on the left, the
// zoom control in the bottom-right corner and the first-use hint near the bottom
// centre. This component also owns the board-wide keyboard: Enter edits the
// selected note, Delete and Backspace remove it — but only while the user is not
// typing, when those keys belong to the text.

import { useCallback, useEffect, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  BoardViewport,
  isTypingTarget,
  type WorldClickHandler,
} from './canvas/BoardViewport';
import { CameraProvider, useBoardCamera } from './canvas/CameraProvider';
import { registerBoardDoc } from './canvas/testHooks';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, viewportCentre, zoomPercent } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';

export interface AppProps {
  /**
   * A document to render instead of a fresh one, bypassing URL routing and the
   * network entirely. Tests use it to hold the same document the app mutates;
   * without it the app reads `/b/:boardId` and syncs that board live.
   */
  doc?: Y.Doc;
}

export default function App(props: AppProps): JSX.Element {
  return (
    <CameraProvider>
      <Router doc={props.doc} />
    </CameraProvider>
  );
}

/**
 * Picks what to render. A document injected by a test draws the plain board with
 * no network at all (component tests never open a socket). Otherwise the board id
 * comes from the URL: `/` mints a fresh board and rewrites the address to
 * `/b/<id>` (server-side creation returns here in story 5), and any other path is
 * a board that does not exist.
 */
function Router({ doc }: AppProps): JSX.Element {
  if (doc !== undefined) return <Board doc={doc} />;
  return <Routed />;
}

function Routed(): JSX.Element {
  const boardId = useState(() => resolveBoardId())[0];
  if (boardId === null) {
    return (
      <div className="board-not-found" data-testid="board-not-found">
        This board address is not valid. Ask for a link that looks like
        <code>/b/&lt;board id&gt;</code>.
      </div>
    );
  }
  return <Board boardId={boardId} />;
}

/** The board id for the current address, minting one for `/`, or null if invalid. */
function resolveBoardId(): string | null {
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    const id = newBoardId();
    window.history.replaceState({}, '', `/b/${id}`);
    return id;
  }
  const match = /^\/b\/([^/]+)\/?$/.exec(path);
  return match !== null && isValidBoardId(match[1] as string) ? (match[1] as string) : null;
}

/** Everything that needs the board camera, the document and the selection. */
function Board({ doc: injected, boardId }: { doc?: Y.Doc; boardId?: string }): JSX.Element {
  const { camera, viewport, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { doc, notes, connection } = useBoardDoc(injected, boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Expose the live document to end-to-end tests (no-op outside the test build).
  useEffect(() => {
    registerBoardDoc(doc);
  }, [doc]);

  /** New note centred on a world point, ready for typing straight away. */
  const createAt = useCallback(
    (world: { x: number; y: number }): void => {
      const id = createSticky(doc, world);
      if (id === '') return;
      startEdit(id);
    },
    [doc, startEdit],
  );

  /** Double-click on empty board space: the note appears centred on the point. */
  const createAtPoint: WorldClickHandler = useCallback(
    (world) => createAt(world),
    [createAt],
  );

  /** The toolbar button: centred in the visible board area, however far it moved. */
  const createAtCentre = useCallback((): void => {
    createAt(screenToWorld(camera, viewportCentre(viewport)));
  }, [createAt, camera, viewport]);

  // The keyboard for a selected note. Every key here is ignored while the user
  // is typing: Delete and Backspace then edit characters, not notes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === 'Enter') {
        if (editingId === null && selectedId !== null) {
          event.preventDefault();
          startEdit(selectedId);
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingId !== null || selectedId === null) return;
        event.preventDefault();
        deleteObject(doc, selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, startEdit]);

  // A note that is no longer on the board cannot stay selected, so the outline
  // and the note toolbar go away with it.
  const selectedGone = selectedId !== null && !notes.some((note) => note.id === selectedId);
  useEffect(() => {
    if (selectedGone) select(null);
  }, [selectedGone, select]);

  return (
    <>
      <BoardViewport onDoubleClickBoard={createAtPoint} onEmptyClick={() => select(null)}>
        {/* One element per note, in creation order; StickyNote stacks it by its z. */}
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCentre} />
      <NavigationHint visible={!hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      {boardId !== undefined ? <ConnectionStatus state={connection} /> : null}
    </>
  );
}
