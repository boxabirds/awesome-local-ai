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

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { checkBoard, type CheckResponse } from '../api';
import {
  BoardViewport,
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
import { useTransformGesture } from '../board/useTransformGesture';
import { useMarquee } from '../board/useMarquee';
import { useBoardKeys } from '../board/useBoardKeys';
import { UndoControllerContext, useUndo, useUndoController } from '../board/useUndo';
import { SelectionOverlay, MarqueeRect, screenBox } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { useTool } from '../board/useTool';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { getObjectType, handlesFor } from '../objects/registry';
import { TextToolbar } from '../objects/TextToolbar';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import { SharePanel } from '../share/SharePanel';
import {
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  newObjectId,
  objectBounds,
} from '../../shared/board-model';
import { createText, setTextSize, type TextSnapshot } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { unionRects } from '../../shared/geometry';
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
  const { doc, notes, texts, objects, connection } = useBoardDoc(injected, boardId);
  const { selection: selectionState, select, toggle, setSelection, clear, startEdit, endEdit } =
    useSelection(objects);
  const selectedIds = selectionState.ids;

  // A board the room could not read is shown, not edited: there is nowhere for a
  // change to go, and a note that looks fine but was never stored is worse than a
  // board that says it is not there. Everything else - a link that is down, a board
  // still arriving - keeps taking edits, because those changes are kept locally and
  // sent when the link returns.
  const editable = canEdit(connection);

  // Which tool the next click on the board belongs to (story 9). Screen state,
  // never document state: two people on one board are not choosing this together.
  const { tool, setTool } = useTool(editable);

  // Who made an object. Story 6 gives a board real people; until then this tab has
  // one id of the same shape, made once and kept, because a `createdBy` that
  // changed every render would be a field that changes on every keystroke.
  const [actorId] = useState<string>(() => newObjectId());

  // This person's undo history, one controller for the life of this mounted board.
  // It is created here (not in App) because the document only exists once
  // `useBoardDoc` has it - for a board from an address as much as for one a test
  // handed over. A reload remounts this component and builds an empty history.
  const undoController = useUndoController(doc);
  const undo = useUndo(undoController, editable);
  const undoBoundary = useCallback(() => undoController.boundary(), [undoController]);

  /**
   * Re-measure these text objects, and store the box their text came to. Called by
   * the things this client changed - a keystroke, a size preset, a resize - and
   * never for a change that arrived from elsewhere, whose measurement is the one
   * this board keeps (two clients measuring the same font differently would see a
   * box that will not settle).
   */
  const remeasure = useCallback(
    (ids: readonly string[]): void => {
      for (const id of ids) remeasureTextBox(doc, id);
    },
    [doc],
  );

  // The three ways a selection acts, all fed by the same selection state:
  // the transform gesture (drag and resize of one or many), the marquee
  // (Shift+drag on empty space) and the keyboard (select-all, nudge, delete,
  // Enter, Escape). None of them knows what an object type is; that is the
  // registry's only job.
  const gesture = useTransformGesture({
    doc,
    selection: selectionState,
    objects,
    zoom: camera.zoom,
    editable,
    onSelect: (id, additive) => (additive ? toggle(id) : select(id)),
    // A drag or resize is one undo step: the window is closed at its start (so the
    // stacking write joins it, not the step before) and again at its end.
    onGestureStart: undoBoundary,
    onGestureEnd: undoBoundary,
    // A transform that scaled a text's box hands the box back to the text, which
    // is the only thing that knows how tall it is now. Inside the gesture's own
    // undo window, so the resize and the box that follows it undo together.
    remeasureTexts: remeasure,
  });
  const marquee = useMarquee({
    objects,
    camera,
    editable,
    onSelectMany: setSelection,
    onEmptyClick: clear,
  });
  // Expose the live document to end-to-end tests (no-op outside the test build).
  useEffect(() => {
    registerBoardDoc(doc);
  }, [doc]);

  /** New note centred on a world point, ready for typing straight away. */
  const createAt = useCallback(
    (world: { x: number; y: number }): void => {
      if (!editable) return;
      // a created note is its own undo step (the editor that opens closes it after)
      undoBoundary();
      const id = createSticky(doc, world);
      if (id === '') return;
      startEdit(id);
    },
    [doc, startEdit, editable, undoBoundary],
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

  // The keyboard comes last of the three ways a selection acts, because two of its
  // keys do the same things the toolbar's buttons do: N makes a sticky note in the
  // middle of the view, and V, T and Escape hold and let go of a tool.
  useBoardKeys({
    doc,
    editable,
    objects,
    selection: selectionState,
    setSelection,
    clear,
    startEdit,
    undo: () => undoController.undo(),
    redo: () => undoController.redo(),
    boundary: undoBoundary,
    tool,
    setTool,
    onCreateSticky: createAtCentre,
  });

  // The selection's bounding box, in world units: what the overlay frames and
  // the bar floats under. It follows the objects through a drag because the
  // snapshot re-renders on every write the gesture makes.
  const selectionRect = useMemo(() => {
    if (selectedIds.size === 0) return null;
    return unionRects(
      objects.filter((object) => selectedIds.has(object.id)).map((object) => objectBounds(object)),
    );
  }, [objects, selectedIds]);

  /**
   * The one selected text object, when the selection is exactly that: what says
   * whether the text toolbar goes up, and what its size button has to show as
   * pressed. Nothing while a caret is in the text, because a toolbar would be a
   * thing to click away from the caret.
   */
  const singleText: TextSnapshot | null = useMemo(() => {
    if (selectedIds.size !== 1 || selectionState.editingId !== null) return null;
    const id = [...selectedIds][0] as string;
    return texts.find((text) => text.id === id) ?? null;
  }, [texts, selectedIds, selectionState.editingId]);

  const bringSelectionToFront = useCallback((): void => {
    undoBoundary();
    bringObjectsToFront(doc, [...selectedIds]);
    undoBoundary();
  }, [doc, selectedIds, undoBoundary]);

  const deleteSelection = useCallback((): void => {
    undoBoundary();
    deleteObjects(doc, [...selectedIds]);
    undoBoundary();
  }, [doc, selectedIds, undoBoundary]);

  /**
   * A click that belongs to the Text tool (story 9): an empty text at the point
   * clicked, ready for the caret. The tool lets go of itself, because the thing you
   * asked for is on the board and the next click on it should select it, not place
   * another one under it.
   */
  const createTextAt = useCallback(
    (world: { x: number; y: number }): void => {
      if (!editable) return;
      undoBoundary();
      const id = createText(doc, world, actorId);
      if (id === null) return;
      setTool('select');
      select(id);
      startEdit(id);
    },
    [doc, editable, actorId, undoBoundary, setTool, select, startEdit],
  );

  const onTextToolClick: WorldClickHandler = useCallback(
    (world) => createTextAt(world),
    [createTextAt],
  );

  /**
   * A size button. The text reflows at the new size and its box follows: width if
   * the width is still the content's, height always. Where it sits does not move,
   * which is why the size is stored rather than a width the size happens to make.
   */
  const changeTextSize = useCallback(
    (size: TextSize): void => {
      if (singleText === null) return;
      undoBoundary();
      if (setTextSize(doc, singleText.id, size)) remeasure([singleText.id]);
      undoBoundary();
    },
    [doc, singleText, undoBoundary, remeasure],
  );

  return (
    <UndoControllerContext.Provider value={undoController}>
      <BoardViewport
        onDoubleClickBoard={createAtPoint}
        onEmptyClick={clear}
        onMarquee={marquee.handlers}
        // The tool the board takes clicks for. While a caret is inside an object
        // that object owns the clicks: a layer over the board would be a layer over
        // the text you are typing in, and the tool is waiting for you to finish -
        // it is still held, as the rail says, and comes back when the caret leaves.
        tool={selectionState.editingId === null ? tool : 'select'}
        onTextToolClick={onTextToolClick}
      >
        {/* One element per note, in creation order; the registry says which
            component draws which type, and a type it does not know draws
            nothing, exactly as the snapshot skips it. */}
        {notes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={selectedIds.has(note.id)}
              single={selectedIds.size <= 1}
              dragging={gesture.draggingIds.has(note.id)}
              editing={note.id === selectionState.editingId}
              editable={editable}
              onGesturePointerDown={(event) => gesture.onObjectPointerDown(event, note.id)}
              onSelect={select}
              onFocusNote={(id) => {
                // A mouse press focuses the note it grabs; the gesture has
                // already made that selection, and a focus landing a moment
                // later must not replace it. Only focus that arrives with no
                // press - the Tab key - selects here.
                if (!gesture.isPressed()) select(id);
              }}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          );
        })}
        {/* Text objects, after the notes: a text sits on top of the note it is
            written across, which is what writing on a board means. Same props,
            same registry, same gesture - the type only decides which component
            draws it and which handles its box has. */}
        {texts.map((text) => {
          const spec = getObjectType(text.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={text.id}
              note={text}
              doc={doc}
              zoom={camera.zoom}
              selected={selectedIds.has(text.id)}
              single={selectedIds.size <= 1}
              dragging={gesture.draggingIds.has(text.id)}
              editing={text.id === selectionState.editingId}
              editable={editable}
              onGesturePointerDown={(event) => gesture.onObjectPointerDown(event, text.id)}
              onSelect={select}
              onFocusNote={(id) => {
                if (!gesture.isPressed()) select(id);
              }}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          );
        })}
      </BoardViewport>
      {selectionRect === null || selectionState.editingId !== null ? null : (
        <SelectionOverlay
          rect={selectionRect}
          transforming={gesture.draggingIds.size > 0}
          // the types in the selection decide how it is resized: a text's height
          // belongs to its text, so a box of nothing but text has two handles
          handles={handlesFor(objects.filter((object) => selectedIds.has(object.id)))}
          onHandlePointerDown={(handle, event) => gesture.onHandlePointerDown(event, handle)}
        />
      )}
      {selectionRect !== null &&
      selectedIds.size > 1 &&
      selectionState.editingId === null &&
      editable ? (
        // The group's own toolbar: what only makes sense for many objects at
        // once. A single selected object keeps its per-type toolbar instead.
        <SelectionBar
          count={selectedIds.size}
          rect={selectionRect}
          onBringToFront={bringSelectionToFront}
          onDelete={deleteSelection}
        />
      ) : null}
      {singleText === null || selectionRect === null || !editable ? null : (
        // A single text object's own toolbar, in the place the selection bar would
        // have stood: the sizes it can be and the bin, and nothing else.
        <div
          className="text-toolbar-anchor"
          data-testid="text-toolbar-anchor"
          style={{
            left: screenBox(camera, selectionRect).x + screenBox(camera, selectionRect).width / 2,
            top: screenBox(camera, selectionRect).y + screenBox(camera, selectionRect).height + 12,
            transform: 'translateX(-50%)',
          }}
        >
          <TextToolbar
            size={singleText.size}
            onSize={changeTextSize}
            onDelete={deleteSelection}
          />
        </div>
      )}
      {marquee.rect === null ? null : <MarqueeRect rect={marquee.rect} />}
      <Toolbar
        onCreateSticky={createAtCentre}
        tool={tool}
        onTool={setTool}
        disabled={!editable}
        disabledReason={BOARD_LOAD_FAILED_MESSAGE}
        undo={undo}
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
    </UndoControllerContext.Provider>
  );
}
