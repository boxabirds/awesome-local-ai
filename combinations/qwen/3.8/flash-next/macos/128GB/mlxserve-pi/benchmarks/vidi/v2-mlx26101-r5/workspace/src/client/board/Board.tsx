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
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { useTransformGesture } from './useTransformGesture';
import { useBoardKeys } from './useBoardKeys';
import { createUndo } from './undo';
import { useUndo, type UndoControls } from './useUndo';
import { boardIdentity } from './identity';
import { MarqueeRect, useMarquee, type Marquee } from './Marquee';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { ObjectView } from '../objects/registry';
import type { BoardContext } from '../objects/registry';
import { ImageRuntimeContext, type ImageRuntime } from '../objects/ImageObject';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { Toast } from '../ui/Toast';
import { defaultMeasurer } from '../objects/textLayout';
import { remeasureTextBox } from '../objects/useTextBoxSync';
import {
  createSticky,
  deleteObjects,
  isTextSnapshot,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { createText, setTextSize, type TextSize } from '../../shared/objects/text';

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
   * The tool the pointer is in: Select, Text, Shape, Connector or Pen — the same pointer with a different job.
   *
   * It is the board's state and not the document's: two people on one board can be in different tools,
   * because a tool is what this person's pointer is doing and nobody else's screen has an interest in
   * that. What the board does with it is here too — the toolbar's buttons, the keys, and the tools that
   * hold the pointer and write for themselves — so that there is one answer to "what happens when I press
   * T", and the same answer to S, to L and to P.
   */
  /**
   * Pictures: the three ways in, the progress of the one this person is sending, and the way out of a
   * failure (story 12).
   *
   * It is given the connection state and not just `editable`, because an upload is an HTTP request and not a
   * document write: a line that is down holds a Yjs update until it comes back, and holds nothing else.
   * Everything it writes goes into the same document as everything else, so a placeholder is shared, moved,
   * resized and deleted by everybody on the board with no new machinery behind any of that.
   */
  const imageInsert = useImageInsert({
    doc,
    boardId: boardId ?? '',
    camera,
    connection: status,
    identityId: boardIdentity().name,
  });

  const tools = useActiveTool({
    canEdit: editable,
    // The thing a tool has just made is what this person wants next, so it comes to them already selected
    // — which is the board's own selection, said to the tool rather than reached into by it.
    select: (id) => selectionRef.current.setMany([id], false),
    // The Image button and the I key: a file picker, not a pointer.
    openImage: imageInsert.openPicker,
  });
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  /**
   * The pen's colour and thickness, for as long as this board is open.
   *
   * Board state and not document state, which is the whole of why a second person sees the finished line in
   * the colour it was drawn in and never sees the choosing: what goes into the document is the stroke with
   * its colour already on it, and this is the setting that picked that colour, which is nobody's business but
   * the drawer's. It is also why nothing here is saved: a pen is picked up for a drawing and put down, and a
   * board that remembered the last person's red on the next person's first stroke would be remembering the
   * wrong thing.
   */
  const pen = usePenOptions();

  /**
   * A point on this screen as the point on the board it is over.
   *
   * The board owns the element the pointer is measured against, so this is the one place the subtraction of
   * its top-left happens — and the same subtraction BoardViewport does for its own gestures, against the
   * same rectangle, because the viewport and this container are both the whole window. Given to the two
   * drawing tools and to every object through the board context below, because a tool that measured the
   * window again would be a second answer to where the board starts.
   */
  const toWorld = useCallback(
    (point: Point): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      return screenToWorld(cameraRef.current, { x: point.x - (rect?.left ?? 0), y: point.y - (rect?.top ?? 0) });
    },
    [],
  );

  /**
   * Every object's box, by id, recomputed whenever the board changes.
   *
   * One map for the frame, handed to the tools and to the objects: an arrow's ends are placed from these,
   * a pointer that is over something is asked of these, and the two drawing tools ask the same question of
   * the same numbers. It is derived from the snapshot and never cached anywhere longer than that, which is
   * what keeps it from ever disagreeing with the object a selection is drawn around.
   */
  const rects = useMemo(
    () => new Map(snapshot.map((object) => [object.id, objectBounds(object)])),
    [snapshot],
  );

  /** What an object is told about the board it is on. See `BoardContext`. */
  const boardContext = useMemo<BoardContext>(
    () => ({ camera, objects: snapshot, rects, toWorld }),
    [camera, snapshot, rects, toWorld],
  );

  /**
   * The Text tool's click: some text begins here, and the pointer goes back to Select.
   *
   * The top-left of the new object is the point that was clicked — not its centre. A person clicking
   * where a heading is going to start means "here is where the words begin", and an object centred on
   * the cursor would put its first letter somewhere the person was not pointing. The editor opens on it
   * straight away, because nobody places a text object and then goes looking for the way to type in it;
   * and if nothing is typed into it, it goes away again when the editor closes, which is the object's
   * own rule and not something this call has to remember.
   */
  const createTextAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      // One created object is one step, for the same reason a created note is: the write that made it
      // must be undoable on its own, and not folded into whatever was done half a second before it.
      const history = undoRef.current;
      history?.boundary();
      const id = createText(docRef.current, world, boardIdentity().name);
      history?.boundary();
      if (typeof id !== 'string') return;
      // Back to Select with the text placed: the next thing a person does with the pointer after
      // putting words down is nearly always something a pointer does anyway.
      toolsRef.current.setTool('select');
      // The click that put this text down was a click on the board, and a click on the board has always
      // meant "whatever was picked out is picked out again". The Text tool listens for that click before
      // the board does, so the clearing it would have done has to be said here — otherwise the object this
      // person was busy with a moment ago stays in the selection next to the one they are about to type
      // into, and a bar about one piece of text becomes a bar about two.
      selectionRef.current.clear();
      startEdit(id);
    },
    [startEdit],
  );

  /**
   * The size of the one selected text object, and the box that goes with it.
   *
   * The two writes are one step and they are always both made: a heading is a different shape from the
   * body text it was, and a document left holding the new size and the old box would be a text object
   * whose selection is the wrong size for its words until somebody types in it. The measurement is
   * taken here, in this person's fonts, by the person who asked for the size — which is the same rule
   * the typing follows, and for the same reason: whoever is watching draws what was written rather
   * than measuring it again and disagreeing about the height of a line.
   */
  const changeTextSize = useCallback(
    (size: TextSize) => {
      if (!editableRef.current) return;
      const current = selectionRef.current;
      if (current.ids.size !== 1) return;
      const id = [...current.ids][0];
      if (id === undefined) return;
      const object = snapshotRef.current.find((candidate) => candidate.id === id);
      if (object === undefined || !isTextSnapshot(object)) return;
      const history = undoRef.current;
      history?.boundary();
      setTextSize(docRef.current, id, size);
      remeasureTextBox(docRef.current, id, defaultMeasurer());
      history?.boundary();
    },
    [],
  );

  /**
   * An object's own bin deleted it. The next snapshot drops the id from the selection — that is the
   * same path as a delete done by somebody else, and the board has no second way to forget an object.
   * This only saves the frame in between, during which the selection would point at nothing.
   */
  const objectDeleted = useCallback((id: string) => {
    if (selectionRef.current.ids.has(id)) selectionRef.current.clear();
  }, []);

  /**
   * What a picture is told about the board it is drawn on: this person's percentages, whether Retry has a
   * file behind it, and how to take a placeholder away.
   *
   * The removal is the same `deleteObjects` the Delete key and the selection bar's bin call, so a placeholder
   * deleted by the button on its own grey box is one undo step in exactly the same way — which is the only
   * way five objects and a failed upload can be deleted together and come back as two separate undos.
   */
  const imageRuntime = useMemo<ImageRuntime>(
    () => ({
      progressOf: (id) => imageInsert.progress.get(id),
      canRetry: imageInsert.canRetry,
      retry: imageInsert.retry,
      remove: (id) => {
        const history = undoRef.current;
        history?.boundary();
        deleteObjects(docRef.current, [id]);
        history?.boundary();
        objectDeleted(id);
      },
    }),
    [imageInsert.progress, imageInsert.canRetry, imageInsert.retry, objectDeleted],
  );

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

  // Select all, escape, the arrows, delete, Enter, the three tool keys, and the two chords that mean
  // undo and redo: the keys the board answers, in one file so that the order they are tried in is
  // written down once.
  useBoardKeys({
    doc,
    selection,
    snapshot,
    canEdit: editable,
    tool: tools.tool,
    onSelectTool: tools.setTool,
    onCreateSticky: createInCentre,
    undo: undoControls,
  });

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
    <div
      className="vidi6-app"
      data-testid="app"
      ref={containerRef}
      // Files dragged over the board are allowed to land on it; everything else a drag might carry is left
      // to the browser. See `useImageInsert`: the drop is validated there, and the highlight that says
      // "drop it here" is drawn by a component that listens for the same events and writes nothing.
      onDragOver={imageInsert.onDragOver}
      onDrop={imageInsert.onDrop}
    >
      <ImageRuntimeContext.Provider value={imageRuntime}>
      <BoardViewport
        controller={controller}
        marquee={marquee}
        onCreateSticky={createAt}
        onCreateText={createTextAt}
        onClearSelection={() => selectionRef.current.clear()}
        tool={tools.tool}
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
            board={boardContext}
            undo={undoControls}
            zoom={camera.zoom}
          />
        ))}
      </BoardViewport>
      </ImageRuntimeContext.Provider>
      {
        // The three tools that hold the pointer themselves. They are rendered while they are lit and on a
        // board that can be written to, and unmounted otherwise — which is also how a tool that is half
        // way through a drag is cancelled: Escape, or a letter, or the board going read-only takes the tool
        // away, the tool's listeners come off with it, and the drag writes nothing on the way out.
        tools.tool === 'shape' && editable ? (
          <ShapeTool
            by={boardIdentity().name}
            camera={camera}
            doc={doc}
            kind={tools.shapeKind}
            onCreated={tools.toolCreated}
            toWorld={toWorld}
            undo={undoControls}
          />
        ) : null
      }
      {
        tools.tool === 'connector' && editable ? (
          <ConnectorTool
            by={boardIdentity().name}
            camera={camera}
            doc={doc}
            objects={snapshot}
            onCreated={tools.toolCreated}
            rects={rects}
            toWorld={toWorld}
            undo={undoControls}
          />
        ) : null
      }
      {
        // The pen, and the one tool of the three that is not handed back after it makes something: no
        // `onCreated`, because a person sketching draws several strokes in a row and a tool that put them
        // back to the arrow pointer after every line would be a tool they had to switch back to by hand.
        // The pen stays until they say otherwise, and saying otherwise is Escape or another letter — which
        // is also the way out of a stroke that has gone wrong, since unmounting this discards whatever it
        // had drawn and had not yet written.
        tools.tool === 'pen' && editable ? (
          <PenTool
            camera={camera}
            color={pen.color}
            doc={doc}
            identityId={boardIdentity().name}
            thickness={pen.thickness}
            toWorld={toWorld}
            undo={undoControls}
          />
        ) : null
      }
      <SelectionOverlay
        camera={camera}
        ids={selection.ids}
        onHandlePointerDown={gesture.onHandlePointerDown}
        snapshot={snapshot}
      />
      <MarqueeRect camera={camera} rect={marquee.rect} />
      <SelectionBar
        ids={selection.ids}
        onDelete={deleteSelection}
        onTextSize={changeTextSize}
        snapshot={snapshot}
      />
      <Toolbar
        canCreate={editable}
        onCreateSticky={createInCentre}
        onShapeKindSelect={tools.setShapeKind}
        onToolSelect={tools.setTool}
        shapeKind={tools.shapeKind}
        tool={tools.tool}
        undo={undoActions}
      />
      {
        // The pen's own choices, beside the pen's button and only while the pen is lit — six colours and
        // three thicknesses that belong to this person and to this visit, next to the tool that uses them.
        tools.tool === 'pen' ? (
          <PenToolbar
            color={pen.color}
            onColor={pen.setColor}
            onThickness={pen.setThickness}
            thickness={pen.thickness}
          />
        ) : null
      }
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
      {
        // The dashed outline over the whole board while a file is being dragged over it. It owns its own
        // listeners and writes nothing, so it is mounted here rather than given the board's drag events.
        <DropHighlight />
      }
      {
        // One line of feedback at a time, at the bottom of the screen: a file that was refused, and the
        // board's reason for refusing it. See `Toast`.
        <Toast />
      }
    </div>
  );
}
