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
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';

import type { CheckResponse } from '../api';
import { checkBoard } from '../api';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { Toolbar } from '../components/Toolbar';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from '../canvas/camera';
import type { Point } from '../canvas/camera';
import { useCamera, useViewportSize } from '../canvas/useCamera';
import { createSticky, deleteObjects, NO_ID } from '../../shared/board-model';
import { isValidBoardId } from '../../shared/board-id';
import { useBoardDoc } from '../board/useBoardDoc';
import type { BoardConnector } from '../board/useBoardDoc';
import { useBoardKeys } from '../board/useBoardKeys';
import { createUndo } from '../board/undo';
import type { UndoController } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { connectBoard } from '../sync/connectBoard';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState } from './state';
import type { BoardPageState } from './state';

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
 * This person's undo history for this board, and nothing else's.
 *
 * One per board document, which is the whole of what "my history" means in a tab: the five people on a
 * board have five of these, in five tabs, and they do not speak to one another. It is held in a ref and
 * created while the board is being drawn — the same shape as the board's document store in `useBoardDoc`,
 * for the same reason: React is allowed to render twice, and a second history of the same board would be
 * a second opinion about what this person did, with a second stack to undo into.
 *
 * It is destroyed when the board goes away, and never revived from anything: there is no history on the
 * server, no history in local storage, and nothing in the document that says what this person did. Closing
 * the tab is the end of the history, which is what the PRD's "undo does not survive a reload" asks for and
 * what makes an undo on a board opened next week a thing that has not happened yet.
 */
function useBoardUndo(doc: Y.Doc): UndoController {
  const ref = useRef<{ doc: Y.Doc; controller: UndoController; live: boolean } | null>(null);
  const [, respawn] = useReducer((count: number) => count + 1, 0);

  const held = (): UndoController => {
    const current = ref.current;
    if (current !== null && current.doc === doc && current.live) return current.controller;
    ref.current = { doc, controller: createUndo(doc), live: true };
    return ref.current.controller;
  };

  const controller = held();

  useEffect(() => {
    // Asked again, because in development React mounts, unmounts and mounts, and the controller that is
    // live by then is not the one this render was handed. Saying so is what stops the board keeping a
    // dead history — one that has stopped listening and would answer every Ctrl+Z with nothing.
    const live = held();
    if (live !== controller) respawn();
    return () => {
      const current = ref.current;
      if (current !== null && current.controller === live) current.live = false;
      live.destroy();
    };
    // The document is the only thing a history belongs to. `controller` and `held` are read rather than
    // depended on, so that handing a board a live history cannot tear down the very history it handed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return controller;
}

/**
 * The board itself: stories 1 to 5, and the Share button.
 *
 * `boardId` is the board as the service said it is called, which for a board that opened is the same
 * string that was in the address. It arrives as a prop rather than being read from the address again so
 * that the link the Share panel hands out is the one that was just checked, and nothing in this tree can
 * ask a question about an address nobody asked about.
 *
 * This is also where the parts of a selection are put together, and the arrangement is worth naming,
 * because each part answers a different question about the same fact. The objects are drawn by the board
 * and stacked by their own number; the outlines and handles are drawn over them, in screen units, so a
 * handle is still a thing that can be hit at ten per cent zoom; the rectangle is drawn only while it is
 * being drawn; and the bar says in words what the outlines say in ink. All four read the one selection,
 * which is the only reason they can never disagree about what is selected — and a selection that
 * disagreed with itself, one outline left behind on an object that has been deleted, is the bug this
 * whole story is built to avoid.
 *
 * The objects are rendered through the registry rather than by naming a component here, which is what
 * lets a later story add a type without touching this file: what is drawn is whatever the board is
 * holding, provided somebody has said how to draw it. An object of a type nobody has registered is left
 * undrawn — not drawn as a sticky note, which would be a lie about somebody's board.
 */
function Board({ boardId, connect }: { boardId: string; connect: BoardConnector }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);
  const { doc, notes, connection } = useBoardDoc(boardId, connect);
  const selection = useSelection(notes);

  /** My history, for this board, in this tab. */
  const undo = useBoardUndo(doc);

  /**
   * The objects in the order they should end up on screen. The document lists them by stacking number;
   * they are put in the page in the order they were made and stacked with `zIndex` (see StickyNote),
   * because moving the element a pointer is holding — which is what re-sorting the list would do every
   * time a note is raised — makes the browser let go of the pointer and the drag stops halfway. Creation
   * order is in the document too, so every client still agrees on which of two equally raised notes is on
   * top.
   */
  const painted = [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const editable = canEdit(connection);

  /** The same history, as the toolbar's two buttons need it: what is there to undo, right now. */
  const undoButtons = useUndo(undo, editable);

  /** The end of a step, which is what a gesture and a group operation both have to say. */
  const boundary = undo.boundary;

  /** The drag: what a press on an object, or on a handle, does to the board. */
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    // One drag, one step. The frames in between are written to the document one after another and have to
    // be had back together, and the only thing that says "these frames are one action" is a boundary at
    // each end: the one at the start keeps a colour clicked just now out of the drag, the one at the end
    // keeps the drag out of whatever is done next. A drag that ends in a cancel still says it, because a
    // drag that moved six notes two thirds of the way is six notes in a new place, and that is a thing a
    // person wants back.
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });

  /** The rectangle: a drag across empty board space, which adds to the selection when it lets go. */
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  /** The keyboard: select all, deselect, nudge, delete, edit, undo, redo. */
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo });

  /** The bin on the selection bar: everything selected at once, and the selection let go afterwards. */
  const deleteSelection = useCallback((): void => {
    if (!editable) return;
    const ids = notes.filter((object) => selection.ids.has(object.id)).map((object) => object.id);
    if (ids.length === 0) return;
    boundary();
    deleteObjects(doc, ids);
    boundary();
    selection.clear();
  }, [boundary, doc, editable, notes, selection]);

  /** Put a note down centred on a world point and start typing straight away. */
  const createStickyAt = useCallback(
    (world: Point): void => {
      // A board that could not be loaded is not written to: see `canEdit`. The gesture is swallowed
      // rather than answered with an error, because the badge above already says what is wrong and what
      // is being done about it.
      if (!editable) return;
      // A note is its own step even when it is made in the middle of a burst of typing — which is exactly
      // when one is made, since a note is usually created and then written in. Without the boundary here,
      // the double-click that made the note and the first word typed into it would be one undo step, and
      // undo would take the note away along with the word.
      boundary();
      // `createSticky` centres the note on the point it is given, so the click point becomes the middle
      // of the note, not its top-left corner.
      const noteId = createSticky(doc, world);
      // A note that could not be created leaves no selection behind it. A note that was created is
      // selected as well as opened for typing — the object a person has just made is the object they are
      // working on, and creation is one of the ways an object becomes selected. The click comes first and
      // the caret second, in the same handler, so React commits one render and the board never shows a
      // note that is typed into but not chosen.
      if (noteId !== NO_ID) {
        selection.click(noteId);
        selection.startEdit(noteId);
      }
      boundary();
    },
    [boundary, doc, editable, selection],
  );

  /** The toolbar button adds a note in the middle of what is on screen. */
  const createStickyInCentre = useCallback((): void => {
    createStickyAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createStickyAt, viewport.height, viewport.width]);

  return (
    <div className="board-app" data-testid="board-root" ref={rootRef}>
      <Toolbar onCreateSticky={createStickyInCentre} disabled={!editable} undo={undoButtons} />
      <BoardViewport
        onCreateAt={createStickyAt}
        onClearSelection={selection.clear}
        marqueeActive={marquee.active}
        onMarqueeBegin={(event) => {
          marquee.begin({ x: event.clientX, y: event.clientY }, event.pointerId);
        }}
      >
        {painted.map((object) => {
          const type = getObjectType(object.type);
          if (type === undefined) return null;
          const Component = type.Component;
          return (
            <Component
              key={object.id}
              object={object}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(object.id)}
              selectedCount={selection.count}
              editing={selection.editingId === object.id}
              readOnly={!editable}
              // Only the object the pointer is holding reports the gesture; the rest of a group that
              // moves with it stays visually at rest, which is the difference between dragging one thing
              // and having several things happen to you.
              interaction={gesture.interactingId === object.id ? gesture.interaction : 'idle'}
              onPointerDown={gesture.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              undo={undo}
            />
          );
        })}
      </BoardViewport>
      {/* Over the board, in screen units: the outline of everything selected, the box around them, and
          the handles that resize the box. */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionBar ids={selection.ids} snapshot={notes} camera={camera} onDelete={deleteSelection} />
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
