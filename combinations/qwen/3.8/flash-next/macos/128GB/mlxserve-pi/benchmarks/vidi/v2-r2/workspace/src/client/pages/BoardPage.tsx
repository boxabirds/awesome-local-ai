// The board page: the link's address, checked before anything is shown.
//
// Why a check at all: the WebSocket tells us whether a board exists too (the room
// answers 404 for one that does not), but it answers that *after* the page has drawn
// a board - so an unknown link would flash an empty board and a spinner before
// saying anything. One `GET /api/boards/:id` first, and the board UI is mounted only
// once the service has said this board is there.
//
//   `/b/<malformed>`  Board not found, and no request sent: an address that cannot
//                     name a board cannot be asked about.
//   `checking`        "Opening board…"
//   `ready`           the stories 1-4 board, with full editing and no sign-in
//   `not_found`       Board not found (the service's answer, so final)
//   `unreachable`     "Couldn't reach vidi6. Retrying…" and a retry on a backoff,
//                     so a page left open on a train comes back by itself
//
// `nextBoardPageState` (./state.ts) makes those decisions; this file asks, renders
// and keeps the timer - which is cleared on unmount, because a retry scheduled for a
// page nobody is looking at is a request nobody asked for.

import { useCallback, useEffect, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { checkBoard, type CheckResponse } from '../api';
import {
  BoardViewport,
  isTypingTarget,
  type WorldClickHandler,
} from '../canvas/BoardViewport';
import { CameraProvider, useBoardCamera } from '../canvas/CameraProvider';
import { registerBoardDoc } from '../canvas/testHooks';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  viewportCentre,
  zoomPercent,
} from '../canvas/camera';
import { Toolbar } from '../board/Toolbar';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { StickyNote } from '../objects/StickyNote';
import { SharePanel } from '../share/SharePanel';
import { createSticky, deleteObject } from '../../shared/board-model';
import { BOARD_LOAD_FAILED_MESSAGE } from '../../shared/protocol';
import { isValidBoardId } from '../../shared/board-id';
import { NotFoundPage } from './NotFoundPage';
import {
  initialBoardPageState,
  nextBoardPageState,
  OPENING_MESSAGE,
  UNREACHABLE_MESSAGE,
  type BoardPageState,
} from './state';

export interface BoardPageProps {
  /** The id from the address, validated or not; validating is this page's job. */
  id: string;
}

export function BoardPage({ id }: BoardPageProps): JSX.Element {
  // A malformed id is answered here rather than at the server, and the answer is
  // the same one the server gives for a board that is not there.
  const malformed = !isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(initialBoardPageState);

  useEffect(() => {
    if (malformed) {
      setState({ kind: 'not_found' });
      return;
    }

    let cancelled = false;
    let timer = 0;
    /** Checks that came back with no answer, this one included: the backoff exponent. */
    let unanswered = 0;
    // The page's own copy of its state. `nextBoardPageState` has to know whether
    // this page already reached a board or a verdict, and reading it out of React's
    // queue inside a `setState` updater is not a place to schedule a timer from.
    let current = initialBoardPageState();

    const check = async (): Promise<void> => {
      let result: CheckResponse;
      try {
        result = await checkBoard(id);
      } catch (error) {
        // A client that throws is a service that did not answer. Nothing else.
        console.error(JSON.stringify({ event: 'board_check_threw', error: String(error) }));
        result = { kind: 'unreachable' };
      }
      if (cancelled) return;
      if (result.kind === 'unreachable') unanswered += 1;

      const next = nextBoardPageState(current, result, unanswered, id);
      current = next;
      setState(next);
      if (next.kind === 'unreachable') timer = window.setTimeout(() => void check(), next.nextRetryMs);
    };

    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, malformed]);

  switch (state.kind) {
    case 'checking':
      return (
        <main className="notice-page" data-testid="board-checking" role="status">
          <div className="notice-card">
            <p className="notice-line" data-testid="checking-message">
              {OPENING_MESSAGE}
            </p>
          </div>
        </main>
      );
    case 'unreachable':
      return (
        <main className="notice-page" data-testid="board-unreachable" role="status">
          <div className="notice-card">
            <p className="notice-line" data-testid="unreachable-message">
              {UNREACHABLE_MESSAGE}
            </p>
            <p className="notice-foot">
              This page keeps trying by itself. There is nothing you need to do.
            </p>
          </div>
        </main>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return <BoardScreen boardId={state.boardId} />;
  }
}

export interface BoardScreenProps {
  /**
   * A document to render instead of one the address names, bypassing the network
   * entirely. Component tests use it to hold the same document the app mutates.
   */
  doc?: Y.Doc;
  /** The board this screen shows, when it came from an address. */
  boardId?: string;
}

/**
 * The board with its camera. Everything the stories 1-4 board needs is inside; the
 * Share button joins them when the board has an address to share (a document a test
 * handed over has none).
 */
export function BoardScreen({ doc: injected, boardId }: BoardScreenProps): JSX.Element {
  return (
    <CameraProvider>
      <BoardContent doc={injected} boardId={boardId} />
    </CameraProvider>
  );
}

/** Everything that needs the board camera, the document and the selection. */
function BoardContent({ doc: injected, boardId }: BoardScreenProps): JSX.Element {
  const { camera, viewport, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { doc, notes, connection } = useBoardDoc(injected, boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // A board the room could not read is shown, not edited: there is nowhere for a
  // change to go, and a note that looks fine but was never stored is worse than a
  // board that says it is not there. Everything else - a link that is down, a board
  // still arriving - keeps taking edits, because those changes are kept locally and
  // sent when the link returns.
  const editable = canEdit(connection);

  // Expose the live document to end-to-end tests (no-op outside the test build).
  useEffect(() => {
    registerBoardDoc(doc);
  }, [doc]);

  /** New note centred on a world point, ready for typing straight away. */
  const createAt = useCallback(
    (world: { x: number; y: number }): void => {
      if (!editable) return;
      const id = createSticky(doc, world);
      if (id === '') return;
      startEdit(id);
    },
    [doc, startEdit, editable],
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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!editable) return; // the board takes no changes, so neither do its keys
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
  }, [doc, selectedId, editingId, startEdit, editable]);

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
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar
        onCreateSticky={createAtCentre}
        disabled={!editable}
        disabledReason={BOARD_LOAD_FAILED_MESSAGE}
      />
      {boardId === undefined ? null : <SharePanel boardId={boardId} />}
      <NavigationHint visible={!hasNavigated} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      {/* A board with no connection at all - the standalone board of a component
          test - has nothing to report, and its state never leaves `connecting`.
          Every state that did arrive came from a room, including `load_failed`,
          which is why that one is shown even here: it is news about the board, and
          news about the board is not allowed to go unreported. */}
      {boardId !== undefined || connection === 'load_failed' ? (
        <ConnectionStatus state={connection} />
      ) : null}
      {connection === 'load_failed' ? (
        // Said once more in the middle of the board, where the board would be: the
        // badge is small, and an empty board needs explaining.
        <div className="board-load-failed" data-testid="board-load-failed" role="alert">
          {BOARD_LOAD_FAILED_MESSAGE}
          <p>
            Nothing you type now would be kept. Try again in a moment - the board
            retries by itself - or ask for the board again later.
          </p>
        </div>
      ) : null}
    </>
  );
}
