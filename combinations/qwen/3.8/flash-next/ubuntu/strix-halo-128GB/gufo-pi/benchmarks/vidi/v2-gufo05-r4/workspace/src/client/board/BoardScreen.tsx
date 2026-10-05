/**
 * The board screen: the infinite canvas from story 1, the sticky notes of story 2, and
 * from story 7 the ways of acting on several objects at once.
 *
 * This component is where the pieces of state meet — the camera (per visit), the document
 * (the board's content), the selection (per client) and the one gesture that transforms
 * whatever is selected — and it holds no behaviour of its own beyond wiring them:
 *
 *  - `useSelection` decides which objects are selected (click, Shift-click, marquee,
 *    Select all, and what somebody else deleted);
 *  - `useTransformGesture` moves and resizes them, in absolute writes from where the
 *    gesture began;
 *  - `useBoardKeys` is Select all, Escape, the arrow nudge, group delete and Enter-to-edit;
 *  - `useTool` holds which tool the pointer is using — Select, or the Text tool that turns
 *    the next click into a piece of text (`text.tool`);
 *  - `SelectionOverlay` and `SelectionBar` say where the selection is and what can be done
 *    to it.
 *
 * Objects are drawn through the registry (`src/client/objects/registry.tsx`), so a type
 * added by a later story arrives with all of the above and no change here.
 *
 * The address *is* the board (`/b/<boardId>`), and since story 5 the address arrives as a
 * prop rather than being invented here. A board screen is rendered only for an id somebody
 * has created (`pages/BoardPage`), and `App` is the router.
 */

import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  boardObjects,
  createSticky,
  deleteObjects,
  objectBounds,
  snapshot
} from '../../shared/board-model';
import { createText } from '../../shared/objects/text';
import { Toolbar } from '../board/Toolbar';
import { createUndo } from '../board/undo';
import { UndoProvider, useUndo } from '../board/useUndo';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection, type SelectionControls } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTool } from '../board/useTool';
import { MarqueeRect, useMarquee } from '../board/Marquee';
import { SelectionBar } from '../board/SelectionBar';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { screenToWorld, canZoomIn, canZoomOut, zoomPercent, type Point } from '../canvas/camera';
import { registerTestHooks, reportConnectionState } from '../canvas/testHooks';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { canEdit } from '../sync/connectBoard';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { CameraProvider, useCameraContext } from '../canvas/useCamera';
import { registerObjectTypes } from '../objects';
import { getObjectType } from '../objects/registry';
import { SharePanel } from '../share/SharePanel';

// The object types the board can draw. Importing this module is what makes a sticky note
// exist as a type, so it happens before the first render of anything.
registerObjectTypes();

export interface BoardScreenProps {
  /**
   * Which board this is. Ignored when a `doc` is handed in, which is what a test uses to
   * get a board screen that never goes on the network.
   */
  boardId?: string;
  /**
   * A board document to use instead of making one. Tests pass a private `Y.Doc`
   * so they can assert on what was stored; story 3 will pass the document that is
   * synced with a room.
   */
  doc?: Y.Doc;
}

/**
 * The board: objects in world space, the selection's box and bar in screen space above
 * them, the tool palette on the left, the zoom control in the corner and the first-use
 * hint until the user moves.
 */
function Board(props: BoardScreenProps): JSX.Element {
  const { camera, viewport, hasNavigated, zoomStep, reset } = useCameraContext();
  // A document handed in by a test is never put on the network: no board id, no
  // provider, and the connection reads `connected`.
  const boardId = props.doc ? undefined : props.boardId;
  const { doc, objects, connection } = useBoardDoc({ boardId, doc: props.doc });

  // One undo history per board document (story 8), scoped to this client's own writes.
  // A fresh document — a board that changed identity — gets a fresh, empty history, and
  // the outgoing controller is torn down with it: undo is session-only and never follows
  // you to another board (`undo.session_only`).
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);

  // The gesture opens an undo step the moment it starts moving and closes it when it
  // stops, so one drag — every frame of it — reverses as one (`undo.drag`).
  const beginGestureStep = useCallback(() => undoController.boundary(), [undoController]);
  const endGestureStep = useCallback(() => undoController.boundary(), [undoController]);

  // Story 4: a board the room could not load is not a board to write on. Everything
  // that would change the document is checked against this, and the handlers that are
  // registered once read it through a ref.
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  // Per-client selection, kept in step with the document: an object somebody else deleted
  // leaves it on its own (`sel.remote_delete`).
  const selection = useSelection(objects);
  const selectionRef = useRef<SelectionControls>(selection);
  selectionRef.current = selection;

  // Which tool the pointer is holding (story 9, `text.tool`). Local state, on purpose:
  // nobody else needs to know that you are holding the Text tool, and a refresh puts the
  // pointer back to Select.
  const { tool, setTool } = useTool(editable);
  const selectTool = useCallback(() => setTool('select'), [setTool]);
  const chooseTextTool = useCallback(() => setTool('text'), [setTool]);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: beginGestureStep,
    onGestureEnd: endGestureStep
  });

  // A marquee *adds* to the selection: you draw a box around the things you are joining
  // to what you already picked (`sel.marquee`).
  const marquee = useMarquee(camera, objects, useCallback((ids: string[]) => selectionRef.current.setMany(ids, true), []));
  const onMarqueeEnd = useCallback(
    (screen: Point | null) => (screen === null ? marquee.cancel() : marquee.end()),
    [marquee]
  );

  /** Delete or Backspace, the bin in the bar, and nothing else: one rule, one place. */
  const deleteSelection = useCallback(() => {
    if (!editableRef.current) return;
    // A boundary either side so the whole group delete is its own undo step, reversing in
    // one go rather than merging with whatever came before it (`undo.group`).
    undoController.boundary();
    deleteObjects(doc, [...selectionRef.current.ids]);
    undoController.boundary();
    selectionRef.current.clear();
  }, [doc, undoController]);

  const undoActions = useUndo(undoController, editable);

  /** Put a new note in the middle of a screen point and start typing it. */
  const createAt = useCallback(
    (screenPoint: Point, document: Y.Doc, startEdit: (id: string) => void) => {
      // A created note is one undo step, closed before editing opens so the typing that
      // follows is a separate step from the creation (`undo.steps`).
      undoController.boundary();
      const id = createSticky(document, screenToWorld(camera, screenPoint));
      undoController.boundary();
      if (!id) return;
      startEdit(id);
    },
    [camera, undoController]
  );

  const createAtScreenCentre = useCallback(() => {
    if (!editableRef.current) return;
    createAt({ x: viewport.width / 2, y: viewport.height / 2 }, doc, selectionRef.current.startEdit);
  }, [createAt, doc, viewport.height, viewport.width]);

  /**
   * The click the Text tool was waiting for: text appears with its top-left where the
   * pointer landed, ready to type, and the tool is spent — back to Select, so the next
   * click selects instead of laying down another empty text (`text.tool`, `text.create`).
   */
  const placeText = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      // One undo step for the creation, closed before editing opens, so the typing that
      // follows is its own step and one Ctrl+Z puts the words back without erasing the
      // object they were typed into (`undo.steps`).
      undoController.boundary();
      const id = createText(doc, world);
      undoController.boundary();
      if (!id) return;
      selectionRef.current.startEdit(id);
      setTool('select');
    },
    [doc, setTool, undoController]
  );

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    onSelectTool: selectTool,
    onTextTool: chooseTextTool,
    onCreateSticky: createAtScreenCentre
  });

  // Test builds expose what the document holds and how the connection looks, so
  // e2e asserts on real state rather than guessing it from the screen.
  useEffect(
    () => registerTestHooks({ getBoard: () => snapshot(doc), getObjects: () => boardObjects(doc) }),
    [doc]
  );
  useEffect(() => reportConnectionState(connection), [connection]);

  // An editor that was open when the board became unwritable is closed, rather than
  // left typing into a document that is about to be replaced by what the room reads.
  useEffect(() => {
    if (!editable && selectionRef.current.editingId) selectionRef.current.endEdit('selected');
  }, [editable]);

  const { startEdit, endEdit, clear } = selection;

  return (
    <UndoProvider controller={undoController}>
      <BoardViewport
        doc={doc}
        canCreateSticky={editable}
        onStickyCreated={startEdit}
        onEmptyClick={clear}
        textTool={tool === 'text'}
        onTextPlace={placeText}
        onMarqueeStart={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={onMarqueeEnd}
      >
        {objects.map((object) => {
          const spec = getObjectType(object.type);
          // A type this build does not know is not drawn at all, rather than wrongly.
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={object.id}
              object={object}
              bounds={objectBounds(object)}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(object.id)}
              selectedCount={selection.ids.size}
              editing={selection.editingId === object.id}
              canEdit={editable}
              transforming={gesture.transforming.has(object.id)}
              gesture={gesture}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          );
        })}
      </BoardViewport>

      {/* The selection lives in screen space, above the board: an outline that scaled with
          the camera would be invisible when zoomed out (`sel.resize`). */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onDelete={deleteSelection}
        disabled={!editable}
      />
      <MarqueeRect rect={marquee.rect} camera={camera} />

      <Toolbar
        onCreateSticky={createAtScreenCentre}
        tool={tool}
        onSelectTool={selectTool}
        onTextTool={chooseTextTool}
        disabled={!editable}
        undo={undoActions}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connection} />
      {/* Share lives here rather than in the toolbar: the toolbar is for making things on
          the board, and this is about who else is looking at it. */}
      {boardId !== undefined && <SharePanel boardId={boardId} />}
    </UndoProvider>
  );
}

/**
 * A board, with its camera.
 *
 * `CameraProvider` is here rather than in `App` because there is exactly one camera per
 * board, and a board that changed identity wants a new one: the person who follows a
 * second link must not inherit the first board's pan (`share.link_stable`).
 */
export function BoardScreen(props: BoardScreenProps): JSX.Element {
  return (
    <CameraProvider>
      <Board {...props} />
    </CameraProvider>
  );
}
