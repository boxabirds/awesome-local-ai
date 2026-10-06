/**
 * The board: everything a person does to a board, and nothing about which board.
 *
 * This used to be `App.tsx`, which knew both — the board, and the address that named it. Story 5
 * put the address side somewhere else (`src/client/router.ts`, `src/client/pages/`), because the
 * page that shows a board now has to be able to say "that link is not a board" and "we cannot
 * reach vidi6" before a board is on screen at all, and a board that takes those answers on
 * itself would be three pages in one file. What is left here is the same board stories 1 to 4
 * drew, taking a `boardId` it is told and connecting to it.
 *
 * Story 7 is the story that stopped this file knowing what a sticky note is. It draws whatever the
 * registry can draw, it hands a press to one gesture that moves as many objects as the selection
 * holds, and it reads the whole snapshot rather than the notes in it. What it still owns is the
 * arrangement: one document, one camera, one selection, and the handful of things that are the
 * board's rather than any object's — the toolbar, the zoom control, the connection, and the keys.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { registerTestHooks } from '../canvas/testHooks';
import { useBoardDoc } from './useBoardDoc';
import { useBoardConnection } from './useBoardConnection';
import { ConnectionStatus } from './ConnectionStatus';
import { canEdit, type BoardStatus, type ConnectBoardOptions } from './connection';
import { useSelection, type Selection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { createUndo } from './undo';
import { useUndo, type UndoControls } from './useUndo';
import { MarqueeRect, useMarquee, type Marquee } from './Marquee';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { ObjectView } from '../objects/registry';
import { createSticky, deleteObjects, type ObjectSnapshot } from '../../shared/board-model';

/** The board fills the window; its size is the camera's viewport. */
const measureWindow = (): Size =>
  typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/** Test handle: the pieces a component test needs to drive and inspect. */
export interface BoardHandle {
  doc: Y.Doc;
  /** Every object on the board, of every type this build can read, in stacking order. */
  snapshot: readonly ObjectSnapshot[];
  selection: Selection;
  /** The marquee, so a test can ask what rectangle is being pulled without a pointer. */
  marquee: Marquee;
}

export interface BoardProps {
  /** Overrides the measured window size (component tests pass a fixed size). */
  viewport?: Size;
  /** Filled in on every render; only used by tests. */
  handle?: { current: BoardHandle | null };
  /**
   * The board to sync with, from `/b/<board id>` in the address (story 3). Left out, the
   * board is a board of one: no room, no badge, nothing to reconnect from — which is what
   * the component tests drive straight into the document. Given by `BoardPage`, which has
   * already established that the board exists; this component never decides that for itself.
   */
  boardId?: string;
  /**
   * How to connect. Normally nobody passes this: the board dials the room for `boardId`. A
   * component test passes a provider of its own, which is the only way to have a room that
   * closes the connection with a particular code on a particular millisecond.
   */
  connect?: ConnectBoardOptions;
}

/**
 * The whole board: the infinite viewport from story 1, the left toolbar, the objects, the zoom
 * control and the first-use hint, all sharing one camera, one `Y.Doc` and one local selection.
 *
 * Four things are the board's and no object's: the camera, the selection, the one gesture that
 * transforms whatever is selected, and the keys. Each lives in its own file and is wired together
 * here, which is the only reason a drag of six objects and a drag of one are the same drag.
 */
export function Board({
  viewport: viewportProp,
  handle,
  boardId,
  connect,
}: BoardProps = {}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Size>(measureWindow);
  const viewport = viewportProp ?? measured;
  const controller = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const { doc, snapshot } = useBoardDoc();
  const selection = useSelection(snapshot);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const docRef = useRef(doc);
  docRef.current = doc;

  // The live connection to the room this board lives in (story 3). Created once per
  // board id, and only when there is a board id to connect to.
  const { status, connection } = useBoardConnection(doc, boardId, connect);
  const statusRef = useRef<BoardStatus>(status);
  statusRef.current = status;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const boardIdRef = useRef<string | null>(boardId ?? null);
  boardIdRef.current = boardId ?? null;

  // Viewport size from a ResizeObserver. A resize changes only the size: the
  // camera's x/y (world point at the top-left) stays put.
  useEffect(() => {
    if (viewportProp) return; // fixed size from the caller
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setMeasured((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportProp]);

  const { camera } = controller;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  /**
   * Whether this board may be written to. One connection state says no: the room answered
   * "I could not read this board", and a change made to a copy of a board that could not be
   * read is not a change anybody is going to see. A dropped line says yes — see `canEdit`.
   */
  const editable = canEdit(status);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  /**
   * This person's undo history, for this document and no other (story 8).
   *
   * It belongs to the document rather than to the board's render, because what it remembers is the
   * document's own past: it is made once when a board is opened and destroyed when the board is closed,
   * and nothing else. A second board in a second tab has its own, holding nothing that was done here;
   * reloading this one starts with an empty history, which is the PRD's `undo.session_only` and not a
   * limitation we worked around — the steps are this tab's memory, and the server has no use for them.
   */
  const undoHistory = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoHistory.destroy(), [undoHistory]);

  /** The two answers the toolbar buttons show, and the two things clicking them asks for. */
  const undoActions = useUndo(undoHistory, editable);
  /**
   * The same, plus the call a write site owes the history: `boundary`, which says that the action
   * being written is over. The keys, the objects and the note editor all take this one object, so the
   * rule "one action, one step" is stated at the place that writes rather than in the history itself.
   */
  const undoControls = useMemo<UndoControls>(
    () => ({ ...undoActions, boundary: undoHistory.boundary }),
    [undoActions, undoHistory],
  );
  // Read by the write sites, which are callbacks that outlive any one render of the board and must
  // not be rebuilt every time an undo button becomes enabled.
  const undoRef = useRef(undoControls);
  undoRef.current = undoControls;

  /**
   * The one way an object is opened for editing: from the toolbar-centred create, from a
   * double-click on the object, from Enter. Going through here means a board that cannot be
   * written to has one door to shut rather than four.
   */
  const startEdit = useCallback((id: string) => {
    if (!editableRef.current) return;
    selectionRef.current.startEdit(id);
  }, []);

  // A board that stops being writable stops being writable *now*, not when the object happens
  // to close: an editor left open on a board the room cannot read invites text that has
  // nowhere to go. The object stays selected, which is where the person left it.
  useEffect(() => {
    if (editable) return;
    const current = selectionRef.current;
    if (current.editingId !== null) current.endEdit();
  }, [editable]);

  /** Creates a note centred on a world point and starts typing in it right away.
   * Used for the toolbar button (screen centre converted once here) and for a
   * double-click on empty board space (the viewport converts). */
  const createAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      // A note created is one step, whatever was done just before it. The editor this write is
      // followed by closes the step from its own side when it mounts, but only after the note was
      // already written — and a write that lands inside somebody else's step cannot be undone alone.
      const history = undoRef.current;
      history?.boundary();
      const id = createSticky(docRef.current, world);
      history?.boundary();
      if (typeof id !== 'string') return;
      startEdit(id);
    },
    [startEdit],
  );

  /** Toolbar button: a note centred in the middle of the visible board area. */
  const createInCentre = useCallback(() => {
    const size = viewportRef.current;
    createAt(screenToWorld(cameraRef.current, { x: size.width / 2, y: size.height / 2 }));
  }, [createAt]);

  /**
   * An object's own bin deleted it. The next snapshot drops the id from the selection — that is the
   * same path as a delete done by somebody else, and the board has no second way to forget an object.
   * This only saves the frame in between, during which the selection would point at nothing.
   */
  const objectDeleted = useCallback((id: string) => {
    if (selectionRef.current.ids.has(id)) selectionRef.current.clear();
  }, []);

  /**
   * The selection bar's delete: the whole selection, in one transaction, whatever is in it. The same
   * call as the Delete key, so a button and a key cannot disagree about how many undo steps a delete
   * of six objects is when story 8 comes to count them.
   */
  const deleteSelection = useCallback(() => {
    const current = selectionRef.current;
    const ids = [...current.ids];
    if (ids.length === 0) return;
    // One press of the button is one step, for one object or for eight: the same as the Delete key,
    // which says the same thing to the same history from the other door.
    const history = undoRef.current;
    history?.boundary();
    deleteObjects(docRef.current, ids);
    history?.boundary();
    current.clear();
  }, []);

  /**
   * A gesture is one step of the history, from the first frame that moves something to the pointer
   * coming up — the drag of a note across the board and the drag of a corner to resize it are each
   * one thing a person did, however many frames of the document they wrote on the way. `boundary` at
   * the start closes whatever was open (a colour, a burst of typing, the drag that ended a moment
   * ago); the one at the end closes this drag, so that whatever comes next is a step of its own.
   * A gesture that turned out to write nothing calls the same two and changes nothing: a step that
   * was never opened is not closed by anything.
   */
  const gestureBoundary = undoHistory.boundary;

  /** One gesture, whatever is selected: press an object and the whole selection moves with it. */
  const gesture = useTransformGesture({
    doc,
    camera,
    snapshot,
    selection,
    canEdit: editable,
    onGestureStart: gestureBoundary,
    onGestureEnd: gestureBoundary,
  });

  /** Shift + drag on empty board space: the rectangle that selects, drawn over everything. */
  const marquee = useMarquee({
    camera,
    snapshot,
    // The marquee *adds*: the rectangle is drawn on top of a selection the person already has, and
    // Shift is the modifier that means "as well as".
    onSelect: (ids) => selectionRef.current.setMany(ids, true),
  });

  // Select all, escape, the arrows, delete, Enter, and the two chords that mean undo and redo: the
  // keys the board answers, in one file so that the order they are tried in is written down once.
  useBoardKeys({ doc, selection, snapshot, canEdit: editable, undo: undoControls });

  if (handle) handle.current = { doc, snapshot, selection, marquee };

  // Test-only hook (excluded from production builds by the mode check).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return registerTestHooks({
      setCamera: (patch) => controllerRef.current.setCamera(patch),
      getCamera: () => controllerRef.current.camera,
      get connectionState() {
        return statusRef.current;
      },
      get connectionStates() {
        return connectionRef.current?.statesSeen() ?? [statusRef.current];
      },
      get boardId() {
        return boardIdRef.current;
      },
    });
  }, []);

  // The selection bar and the resize handles are drawn over the board, in screen coordinates: the
  // box is one rectangle around however many objects there are, and a handle is a fixed size on the
  // screen whatever the board is scaled to.
  return (
    <div className="vidi6-app" data-testid="app" ref={containerRef}>
      <BoardViewport
        controller={controller}
        marquee={marquee}
        onCreateSticky={createAt}
        onClearSelection={() => selectionRef.current.clear()}
      >
        {snapshot.map((object) => (
          <ObjectView
            key={object.id}
            doc={doc}
            dragging={gesture.movingIds.has(object.id)}
            editable={editable}
            editing={selection.editingId === object.id}
            obj={object}
            onDeleted={objectDeleted}
            onEndEdit={selection.endEdit}
            onObjectPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.click}
            onStartEdit={startEdit}
            pressed={gesture.pressedId === object.id}
            selected={selection.ids.has(object.id)}
            soleSelected={selection.ids.size === 1 && selection.ids.has(object.id)}
            undo={undoControls}
            zoom={camera.zoom}
          />
        ))}
      </BoardViewport>
      <SelectionOverlay
        camera={camera}
        ids={selection.ids}
        onHandlePointerDown={gesture.onHandlePointerDown}
        snapshot={snapshot}
      />
      <MarqueeRect camera={camera} rect={marquee.rect} />
      <SelectionBar ids={selection.ids} onDelete={deleteSelection} snapshot={snapshot} />
      <Toolbar canCreate={editable} onCreateSticky={createInCentre} undo={undoActions} />
      <ZoomControls
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onReset={controller.reset}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        zoomPercent={zoomPercent(camera)}
      />
      <NavigationHint visible={!controller.hasNavigated} />
      <ConnectionStatus state={status} />
    </div>
  );
}
