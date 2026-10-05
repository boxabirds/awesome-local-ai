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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
import { createText } from '../../shared/objects/text';
import { attachableRects } from '../../shared/objects/connector';
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
import { useActiveTool, isDrawingTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { useTransformGesture } from '../board/useTransformGesture';
import { getObjectType } from '../objects/registry';
import { ImageContext, useImageClock } from '../objects/ImageObject';
import type { ImageContextValue } from '../objects/ImageObject';
import { isImageSnapshot } from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { Toasts } from '../ui/Toast';
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

  /**
   * The pointer's tool: Select, Text, Shape or Connector — one hook holding one answer.
   *
   * Taken apart here rather than carried as one object, because the functions in it are stable and the
   * object around them is not — a callback that depended on `tool` would be remade every render, and every
   * board gesture handler that depended on it would be remade with it, for no reason at all.
   *
   * `toolCreated` is what a tool calls when it has made something: the new object becomes the selection and
   * the tool goes back to Select, which is the same thing a double-clicked note does to itself and the reason
   * the board does not go on drawing at every click after the one shape somebody asked for. Passing
   * `selection.click` in rather than letting the tool reach for the selection is what keeps a tool testable
   * on its own — and what keeps one object, the selection, being changed by one owner.
   *
   * This hook is called *before* `useBoardKeys` below, and that order is the whole of how Escape and `S` mean
   * one thing rather than two while a tool is armed: two listeners on the same window, and the one registered
   * first is the one that gets to answer first.
   */
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    select: selection.click,
    // `I` does not arm a tool: it asks the board for a picture, which opens the file window. The key lives with
    // the other tool keys because that is where single letters are answered, and the gesture it starts is not a
    // mode — see `onImageRequest`.
    onImageRequest: () => {
      images.openPicker();
    },
  });

  /**
   * Pictures, and the three ways a person can hand one over.
   *
   * The hook holds the flow — validation, decoding, placeholders, uploads, retry — and this is where it is
   * plugged into the board: the camera, so a drop knows where it landed; the viewport, so a paste knows where the
   * middle of the screen is; the connection, because an unreachable board is the one thing that must stop an image
   * being added; and the undo boundary, so that dropping four files is one thing that happened rather than four
   * things the `Z` key has to walk back through.
   *
   * `identityId` is the document's own name for this tab. It is not a person and not a device: two tabs on one
   * laptop are two uploaders, which is exactly right, because the tab that is uploading a picture is the only tab
   * that has the file, and the progress bar belongs to it alone.
   */
  const imageInput = useRef<HTMLInputElement | null>(null);
  /** Whether anything is still on its way up, which is the only reason a board needs to look at the clock. */
  const uploading = notes.some((object) => isImageSnapshot(object) && object.status === 'uploading');
  const clock = useImageClock(uploading);
  const images = useImageInsert({
    doc,
    boardId,
    camera,
    viewport,
    connection,
    identityId: String(doc.clientID),
    inputRef: imageInput,
    boundary,
    objects: notes,
    // Whatever the file window ended with — a choice, or a cancel — the pointer is back to Select. A board left
    // in some other mode after a window nobody answered has a cursor whose meaning nobody can see.
    onSettled: () => {
      setTool('select');
    },
  });

  /**
   * What an image on the board is allowed to know about this tab.
   *
   * The objects are drawn through the registry, which hands a component the props every object gets and knows
   * nothing about uploads — so the progress of one picture, the two buttons that belong to a failed one, and the
   * one clock that decides when an upload counts as abandoned are handed down here instead, to the two components
   * that ask for them. See `ImageContext` for why it is a context and not four more props on every object.
   */
  const imageActions = useMemo<ImageContextValue>(
    () => ({
      now: clock,
      progress: images.progress,
      retry: images.retry,
      remove: images.remove,
      canRetry: images.canRetry,
    }),
    [clock, images.canRetry, images.progress, images.remove, images.retry],
  );

  /**
   * A paste that is not typing adds the pictures in it to the board.
   *
   * The listener is on the window, because a paste belongs to whatever has the focus and the board does not have
   * it: after a person clicks the background the focus is the page, after a note they stopped typing in it may
   * still be the note, and a board that only listened for pastes on itself would answer one of those two. What
   * decides is not where the event was listened for but where it started — `onPaste` looks at its own target and
   * keeps out of the way of anything that is being typed into, so this listener is hearing about every paste on
   * the page and answering none of the ones that belong to a field.
   */
  const onPaste = images.onPaste;
  useEffect(() => {
    const paste = (event: ClipboardEvent): void => {
      onPaste(event);
    };
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('paste', paste);
    };
  }, [onPaste]);

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

  /**
   * The toolbar button adds a note in the middle of what is on screen, and `N` does the same thing.
   *
   * Both go through here rather than the key having its own route to `createSticky`, because the middle of
   * the screen is decided by the camera and the viewport, and a key that put a note somewhere else than the
   * button does would be two commands wearing one name.
   */
  const createStickyInCentre = useCallback((): void => {
    createStickyAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createStickyAt, viewport.height, viewport.width]);

  /**
   * Put a piece of text down with its top-left corner on a world point, and start typing into it.
   *
   * The tool steps aside *before* the text is made, not after. It is a small thing in a straight line of
   * code and a large one on a slow connection: the arm is disarmed the moment the placement is decided, so
   * there is no stretch of time in which a second click — a double click, a impatient third click — finds
   * the tool still armed and puts another empty object down. The one thing the tool promises is that it
   * places one thing and stops, and the order in this function is what makes that true.
   *
   * The new text is then selected as well as opened for typing, exactly as a note is: the object a person
   * has just made is the object they are working on, and an outline is how a board says which one that is.
   */
  const createTextAt = useCallback(
    (world: Point): void => {
      if (!editable) return;
      // The tool steps aside before the text is made, not after: see the note on `createTextAt`.
      setTool('select');
      // One creation, one step: the same reason as for a note, and the same shape — a boundary at each end,
      // so the text and the first words typed into it are not one undo.
      boundary();
      const textId = createText(doc, world, String(doc.clientID));
      // A point that is not a point — a camera that has gone wrong somewhere — creates nothing, and leaves
      // no selection behind it either.
      if (textId !== null) {
        toolCreated(textId);
        selection.startEdit(textId);
      }
      boundary();
    },
    [boundary, doc, editable, selection, setTool, toolCreated],
  );

  /**
   * The boxes of everything that has a surface, once per render of the board.
   *
   * An arrow's two ends live on other objects, so every arrow needs to know where the objects are — and an
   * arrow that went and read the document to find out would read the whole board once per arrow, on every
   * frame of every drag. The board has already read them, so the answer is handed down and one pass is made
   * instead of one per object.
   */
  const rects = useMemo(() => attachableRects(notes), [notes]);

  /**
   * The pen's ink and nib, for as long as this page is open.
   *
   * Session state and nothing more: it is not written to the document (a stroke keeps the names it was drawn
   * with forever) and not shared (what somebody else's pen is filled with is nobody's business here).
   */
  const pen = usePenOptions();

  /**
   * The sheet the armed tool draws on, or nothing.
   *
   * Only one tool at a time has a sheet, and the two that have one are not rendered at all otherwise: a tool
   * that is not armed should not be in the tree, because a component that is mounted and idle is a component
   * that can be wrong, and this one's job is to hold the pointer.
   */
  const toolOverlay =
    tool === 'shape' ? (
      <ShapeTool doc={doc} kind={shapeKind} camera={camera} onCreated={toolCreated} />
    ) : tool === 'connector' ? (
      <ConnectorTool doc={doc} objects={notes} camera={camera} onCreated={toolCreated} />
    ) : tool === 'pen' ? (
      // The pen is the one tool that does not use `toolCreated`. A stroke is selected, as every new object is
      // — the thing just drawn is the thing being worked on — but the tool itself stays where it was, because
      // an annotation is never one line and a pen that stepped aside after the first would have to be picked
      // up again for every one after it. `selection.click` on its own is the whole of the difference.
      <PenTool
        doc={doc}
        camera={camera}
        color={pen.color}
        thickness={pen.thickness}
        undo={undo}
        onCreated={selection.click}
      />
    ) : null;

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

  /** The keyboard: select all, deselect, nudge, delete, edit, undo, redo, and a new note. */
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo, onCreateSticky: createStickyInCentre });

  return (
    <div className="board-app" data-testid="board-root" ref={rootRef}>
      <Toolbar
        onCreateSticky={createStickyInCentre}
        tool={tool}
        onSelectTool={() => {
          setTool('select');
        }}
        onTextTool={() => {
          setTool('text');
        }}
        onShapeTool={() => {
          setTool('shape');
        }}
        onConnectorTool={() => {
          setTool('connector');
        }}
        onPenTool={() => {
          setTool('pen');
        }}
        onAddImage={images.openPicker}
        shapeKind={shapeKind}
        onShapeKind={setShapeKind}
        disabled={!editable}
        undo={undoButtons}
      />
      {/* The pen's own options, beside the pen. Shown with the tool and hidden without it, which is the rule
          every per-tool control on this board follows: a choice about what to draw next is not a choice about
          anything at all while another tool is holding the pointer. */}
      {tool === 'pen' ? (
        <PenToolbar
          color={pen.color}
          thickness={pen.thickness}
          onColor={pen.setColor}
          onThickness={pen.setThickness}
          disabled={!editable}
        />
      ) : null}
      {/*
       * The file window the Image button and `I` open.
       *
       * A real input, in the page, and not one created in a callback when it is needed. It is the only way a
       * picture can be asked for out of a click — a browser opens a file window in answer to a user gesture on an
       * input, and to nothing else — and putting it in the page means the board owns one node that React takes
       * away when the board goes. It is hidden rather than absent because an input that is not in the page cannot
       * be opened at all, and it is out of the tab order because the button that opens it is the thing a keyboard
       * should reach.
       */}
      <input
        ref={imageInput}
        data-testid="image-file-input"
        className="image-input"
        type="file"
        multiple
        accept={IMAGE_ACCEPTED_TYPES.join(',')}
        tabIndex={-1}
        aria-label="Add images"
        onChange={(event) => {
          images.onPicked(event);
        }}
      />
      <BoardViewport
        onCreateAt={createStickyAt}
        onClearSelection={selection.clear}
        marqueeActive={marquee.active}
        textTool={tool === 'text'}
        activeTool={tool}
        toolOverlay={toolOverlay}
        onCreateTextAt={createTextAt}
        onFilesDragEnter={images.onDragEnter}
        onFilesDragOver={images.onDragOver}
        onFilesDragLeave={images.onDragLeave}
        onFilesDrop={images.onDrop}
        onMarqueeBegin={(event) => {
          marquee.begin({ x: event.clientX, y: event.clientY }, event.pointerId);
        }}
      >
        <ImageContext.Provider value={imageActions}>
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
                rects={rects}
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
        </ImageContext.Provider>
      </BoardViewport>
      {/* The dashed outline, while files are being held over the board. It is drawn here rather than inside the
          viewport because it is an answer about the whole board area and not a layer of it: the outline is a
          promise about where the files will land, and the world layer underneath it is scrolling, zooming and
          full of other people's objects. */}
      {images.dropping ? <DropHighlight /> : null}
      {/* Over the board, in screen units: the outline of everything selected, the box around them, and
          the handles that resize the box. */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
        // A drawing tool takes every press the board gets, and the handles are painted over the board: while a
        // pen is in the hand, the handle that sits where the next stroke starts would resize the last stroke
        // instead of drawing a new one.
        interactive={!isDrawingTool(tool)}
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
      {/* The refusals, at the bottom of the screen. One place says them, and the board is not it: a file that was
          turned away leaves nothing on the board to point at, so the news has to be somewhere that does not
          depend on the object that was not created. */}
      <Toasts />
    </div>
  );
}
