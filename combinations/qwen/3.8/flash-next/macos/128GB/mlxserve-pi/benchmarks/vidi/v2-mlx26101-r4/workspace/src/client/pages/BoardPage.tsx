/**
 * The board, and the asking that has to happen before it.
 *
 * Two things live in this file, and they are joined by a question. The first is whether the address
 * in the bar belongs to a board at all: a link is a thing people type from memory, from a chat log,
 * from a screenshot, and the second-worst answer to a broken one is an empty board (the worst is an
 * empty board that says nothing, which is what this app used to show). So the page asks, and what it
 * gets back is one of three things: there is a board, there is not, or it could not find out. The
 * last of those is why the asking has a state of its own and a retry on a clock — a service having a
 * bad minute is not evidence that a person's board is gone, and saying so is the difference between
 * a page that waits and a page that lies.
 *
 * The second thing is the board itself, unchanged from stories 1 to 4: the document, the camera, the
 * selection, the notes, and the keyboard. It is mounted only once the answer is yes, so it never has
 * to be rendered for an address that has nothing behind it, and nothing is ever typed into a board
 * that is about to turn out not to exist.
 *
 * The Share button sits on top of it in the corner, and it is here rather than on a page of its own
 * because what it hands out is this address — the one in the bar, the one the person arrived at — and
 * a sharing control that shows a different address than the one being looked at is a bug waiting to
 * send somebody to the wrong board.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { CheckResponse } from '../api';
import { checkBoard } from '../api';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { Toolbar } from '../components/Toolbar';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from '../canvas/camera';
import type { Point } from '../canvas/camera';
import { useCamera, useViewportSize } from '../canvas/useCamera';
import { createSticky, deleteObject, NO_ID } from '../../shared/board-model';
import { isValidBoardId } from '../../shared/board-id';
import { useBoardDoc } from '../board/useBoardDoc';
import type { BoardConnector } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState } from './state';
import type { BoardPageState } from './state';

/** Keys that delete a selected note, and nothing else. */
const DELETE_KEYS = ['Delete', 'Backspace'];

/**
 * How a page asks whether a board is there. The real one is in `api.ts`, and it is a promise.
 *
 * It is allowed to answer without one. A caller that already knows — a component test, or a page that
 * asked a moment ago and remembers — can say so synchronously, and the board is up on the first
 * render instead of the second. Nothing about the product depends on the difference, and the board
 * tests depend on it: they are about a board that is already open, and a test that had to wait for an
 * answer it supplied itself would be testing nothing but the waiting.
 */
export type BoardChecker = (id: string) => CheckResponse | Promise<CheckResponse>;

/** Whether a checker has answered already. */
function isPending(answer: CheckResponse | Promise<CheckResponse>): answer is Promise<CheckResponse> {
  return typeof (answer as Promise<CheckResponse>).then === 'function';
}

/**
 * Whether this board may be written to.
 *
 * Every state except `load_failed` leaves the board editable, including the states in which nothing
 * is reaching anybody: a board that cannot be written down, or cannot be reached, still holds what is
 * typed and sends it when it can, so taking the keyboard away would only lose work. `load_failed` is
 * the opposite — the room has said it cannot read this board, and is holding back rather than handing
 * over an empty one — so notes created now would be written into a document that is about to be thrown
 * away. Editing stops until the board arrives; the first successful sync turns it back on, with no
 * reload.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export interface BoardPageProps {
  /** The board this address is about, as it was written in the address. */
  id: string;
  /**
   * How a board document reaches its room. Not a product knob: the board's own component tests hand
   * this a connection that connects to nothing, so that a test about a canvas is not also a test
   * about a socket.
   */
  connect?: BoardConnector;
  /** Whether the board exists. Tests hand this one the answer they want the page to have. */
  check?: BoardChecker;
}

export function BoardPage({
  id,
  connect = connectBoard,
  check = checkBoard,
}: BoardPageProps): JSX.Element {
  // A malformed address ends the search before it starts. This is not a shortcut: an id that is not a
  // possible id must not be sent to the service, because the answer to that question is the same for
  // every malformed address and the asking is what tells anybody that the two are different.
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking', boardId: id } : { kind: 'not_found' },
  );
  /** The checks this page has asked for, so the second failure can be waited out twice as long. */
  const attempts = useRef(0);

  // The document is only asked for once there is a board to ask it about — see the render below,
  // which mounts this hook in no other state. Connecting in the state machine's `ready` branch is
  // also what keeps a dead link from opening a socket at it.
  const asking = state.kind === 'checking';

  useEffect(() => {
    if (!asking) return;
    // Whether this answer is still wanted. A page that has been left, or that has asked again in the
    // meantime, has no use for it: opening a board from an answer about the address the person has
    // already walked away from is how a page ends up somewhere they did not go.
    let wanted = true;
    attempts.current += 1;
    const attempt = attempts.current;
    const apply = (result: CheckResponse): void => {
      if (!wanted) return;
      setState((current) => nextBoardPageState(current, result, attempt));
    };
    // A checker that throws is a service that did not answer, which is the one thing `unreachable`
    // already means. Without this the page would sit on "Opening board…" forever, which is a page
    // that has run out of things to say rather than a page that is waiting.
    const refuse = (): void => {
      apply({ kind: 'unreachable' });
    };
    try {
      const answer = check(id);
      if (isPending(answer)) void answer.then(apply, refuse);
      else apply(answer);
    } catch {
      refuse();
    }
    return () => {
      wanted = false;
    };
  }, [asking, check, id]);

  // The wait between checks. It is a timer in an effect with a cleanup rather than a `setTimeout`
  // nobody owns, because the person may leave the page during it and a page that is gone has no
  // business navigating anywhere.
  useEffect(() => {
    if (state.kind !== 'unreachable') return;
    const retry = setTimeout(() => {
      setState({ kind: 'checking', boardId: state.boardId });
    }, state.nextRetryMs);
    return () => {
      clearTimeout(retry);
    };
  }, [state]);

  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'checking') {
    return (
      <main className="page" data-testid="board-loading">
        <div className="page__card">
          {/* The words the PRD asks for: the person is told what is happening, and nothing is
              promised about how long it takes. */}
          <p className="page__busy" role="status" data-testid="board-opening">
            Opening board…
          </p>
        </div>
      </main>
    );
  }
  if (state.kind === 'unreachable') {
    return (
      <main className="page" data-testid="board-unreachable">
        <div className="page__card">
          <p className="page__busy" role="status" data-testid="board-unreachable-message">
            Couldn't reach vidi6. Retrying…
          </p>
          {/* Not the message itself, so that the message stays the sentence the product promises and
              this remains something a test can read without depending on it. */}
          <p className="page__footnote" data-testid="board-next-check">
            Attempt {state.attempt} · next try in {state.nextRetryMs / 1000}s
          </p>
        </div>
      </main>
    );
  }

  return <Board boardId={state.boardId} connect={connect} />;
}

/**
 * The board itself: stories 1 to 4, and the Share button.
 *
 * `boardId` is the board as the service said it is called, which for a board that opened is the same
 * string that was in the address. It arrives as a prop rather than being read from the address again
 * so that the link the Share panel hands out is the one that was just checked, and nothing in this
 * tree can ask a question about an address nobody asked about.
 */
function Board({ boardId, connect }: { boardId: string; connect: BoardConnector }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);
  const { doc, notes, connection } = useBoardDoc(boardId, connect);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  /**
   * The notes in the order they should end up on screen. The document lists them by stacking number;
   * they are put in the page in the order they were made and stacked with `zIndex` (see StickyNote),
   * because moving the element a pointer is holding — which is what re-sorting the list would do every
   * time a note is raised — makes the browser let go of the pointer and the drag stops halfway.
   * Creation order is in the document too, so every client still agrees on which of two equally raised
   * notes is on top.
   */
  const painted = [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /**
   * A note is only selected while it exists. Deleting it — from the bin, with the keyboard, or from
   * whoever joins the board later — lets the selection, and any editing inside it, go with it instead
   * of pointing at nothing.
   */
  const editable = canEdit(connection);
  const selected = notes.some((note) => note.id === selectedId) ? selectedId : null;
  const editing = notes.some((note) => note.id === editingId) ? editingId : null;

  useEffect(() => {
    if (selectedId !== null && selected === null) select(null);
    if (editingId !== null && editing === null) select(null);
  }, [selectedId, editingId, selected, editing, select]);

  /** Put a note down centred on a world point and start typing straight away. */
  const createStickyAt = useCallback(
    (world: Point): void => {
      // A board that could not be loaded is not written to: see `canEdit`. The gesture is swallowed
      // rather than answered with an error, because the badge above already says what is wrong and
      // what is being done about it.
      if (!editable) return;
      // `createSticky` centres the note on the point it is given, so the click point becomes the
      // middle of the note, not its top-left corner.
      const noteId = createSticky(doc, world);
      // A note that could not be created leaves no selection behind it.
      if (noteId !== NO_ID) startEdit(noteId);
    },
    [doc, startEdit, editable],
  );

  /** The toolbar button adds a note in the middle of what is on screen. */
  const createStickyInCentre = useCallback((): void => {
    createStickyAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createStickyAt, viewport.height, viewport.width]);

  // Keyboard shortcuts, on the window so they work wherever the focus is — with two exceptions: while
  // typing in a note, and while a text field has the focus, the keys belong to the text and must reach
  // it untouched.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || isTextField(target))) return;
      // Escape is the note's own business: it keeps the text and stops editing.
      if (editing !== null) return;
      // A shortcut with a modifier held is the browser's or the operating system's, not ours
      // (Cmd+Backspace, Ctrl+Backspace, Alt+Backspace).
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Enter') {
        if (selected === null || !editable) return; // nothing selected, or nothing to type into
        event.preventDefault();
        startEdit(selected);
        return;
      }
      if (!DELETE_KEYS.includes(event.key)) return;
      if (selected === null || !editable) return;
      // Stop the browser going back a page on Backspace.
      event.preventDefault();
      deleteObject(doc, selected);
      select(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editing, select, selected, startEdit, editable]);

  return (
    <div className="board-app" data-testid="board-root" ref={rootRef}>
      <Toolbar onCreateSticky={createStickyInCentre} disabled={!editable} />
      <BoardViewport onCreateAt={createStickyAt} onClearSelection={() => select(null)}>
        {painted.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selected}
            editing={note.id === editing}
            readOnly={!editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          zoomStep('in');
        }}
        onZoomOut={() => {
          zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connection} />
      {/* The link this page was opened with, offered back to the person who opened it. */}
      <SharePanel boardId={boardId} />
    </div>
  );
}

/** Keys typed here are text, not board commands. */
function isTextField(element: HTMLElement): boolean {
  const name = element.nodeName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
}
