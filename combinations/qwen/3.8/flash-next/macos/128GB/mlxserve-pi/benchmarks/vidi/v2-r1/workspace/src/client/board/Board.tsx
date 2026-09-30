import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObjects } from '../../shared/board-model';
import { createText } from '../../shared/objects/text';
import type { BoardObject } from '../../shared/board-model';
import { BoardViewport, type MarqueeHandlers } from '../canvas/BoardViewport';
import { useBoardCamera } from '../canvas/BoardViewport';
import {
  canZoomIn as canZoomInWith,
  canZoomOut as canZoomOutWith,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
} from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from './useBoardDoc';
import { useSelection, type UseSelectionResult } from './useSelection';
import { useTransformGesture, type TransformGestureHandlers } from './useTransformGesture';
import { useMarquee, MarqueeRect, type MarqueeState } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { useUndo, type UseUndoResult } from './useUndo';
import { createUndo, type UndoController } from './undo';
import { TOOL_SELECT, type Tool } from './useTool';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import type { ShapeKind } from '../../shared/config';
import { createLocalIdentity } from './localIdentity';
import { reportConnectionState } from '../canvas/testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { getObjectType } from '../objects/registry';
import { SharePanel } from '../share/SharePanel';

/**
 * The board itself: an infinite, pannable, zoomable canvas (story 1) holding objects
 * (sticky notes since story 2), live-connected to a room (story 3) and saved
 * (story 4). Story 7 added the selection: a set of objects that can be moved,
 * resized and deleted together, by click, shift-click, marquee, select-all, arrow
 * keys or the bar above the board.
 *
 * What is wired here:
 *
 *   - `useSelection`   — which objects are selected (local state, never shared)
 *   - `useTransformGesture` — the one gesture that moves or resizes them
 *   - `useMarquee`     — the shift-drag box that adds to the selection
 *   - `useBoardKeys`   — select all, clear, nudge, delete
 *
 * The camera and the selection belong to this screen; only the objects are shared.
 * A board is given, never invented here: which board this is, and whether it exists,
 * is decided above this component (share.not_found).
 */
export function Board({ boardId }: { boardId: string }): ReactNode {
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  // A board the room could not read is shown and not edited: the objects on the
  // screen are whatever the last successful read found, and writing into a board we
  // cannot see the whole of is how a board gets lost (persist.corrupt_snapshot).
  const canEdit = connectionState !== 'load_failed';

  // The camera is owned by <BoardViewport>, which is rendered by this component but
  // below it, so it comes back up through the chrome (which reads it from the
  // viewport's context). Screen-to-world conversion needs it: a marquee, a double-click
  // and a drag all arrive in screen pixels.
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);

  // This tab's undo history (story 8). One controller per board, made with the
  // document and thrown away when the board goes. The `boundary()` it hands round is
  // what turns each action — a drag, a keystroke burst, a delete, a nudge — into one
  // undo step; the controller itself only ever captures this tab's `LOCAL_ORIGIN`
  // transactions, so what it undoes is this person's work and no one else's.
  const undoController = useMemo<UndoController>(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);
  const undoBoundary = useCallback((): void => {
    undoController.boundary();
  }, [undoController]);

  // Who this tab is, for the `createdBy` a text object carries. Story 6 (who is here)
  // is not built, so it is a per-tab id and nothing more than that.
  const identity = useMemo(createLocalIdentity, []);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart: undoBoundary,
    onGestureEnd: undoBoundary,
  });
  const marquee = useMarquee(camera, objects, (ids): void => {
    selection.setMany(ids, true);
  });

  const undoState = useUndo(undoController, canEdit);

  /** Delete what is selected, and stop selecting it. */
  const deleteSelection = useCallback((): void => {
    // One undoable step, so an accidental delete of a whole cluster comes back in one.
    undoBoundary();
    deleteObjects(doc, [...selection.ids]);
    undoBoundary();
    selection.clear();
  }, [doc, selection, undoBoundary]);

  // A thing this board just made is the thing you want next: selected, and — for
  // something whose whole point is what is written in it — open to be written in.
  const onCreated = useCallback(
    (id: string): void => {
      selection.click(id);
      selection.startEdit(id);
    },
    [selection],
  );

  // A shape or an arrow a tool just drew is selected and left closed: what you do to an
  // arrow next is move it or move what it points at, and a label editor that opened by
  // itself would take the keyboard out of your hands (`tools.return_to_select`).
  const selectCreated = useCallback((id: string): void => selection.click(id), [selection]);

  // Which tool is up (`text.tool_ui`, `tools.active_tool`). A board that cannot be
  // edited neither gets a tool that writes nor keeps one. Story 9 had two tools and this
  // state lived in `useTool`; with a Shape tool and a Connector tool, the rule they all
  // share — a tool is put away once it has drawn the thing it draws — is here, and the
  // object it just drew becomes the selection, because that is the thing you want to fix.
  const tools = useActiveTool({ canEdit, onSelect: selectCreated });

  /**
   * Write something at a point (`text.create`): top-left under the click, size M,
   * above everything, in the editor's hands before the pointer comes up again. That
   * feels like one action and is several writes; the undo boundary is what makes it one
   * to undo, so a click made by mistake takes the object back with it.
   */
  const placeText = useCallback(
    (screen: Point): void => {
      if (!canEdit) return;
      undoController.boundary();
      const id = createText(doc, screenToWorld(camera, screen), identity.id);
      undoController.boundary();
      // The tool is done: it asked what goes here, and it went. Staying on Text would
      // make the next click another one, which is what a stamp does.
      tools.setTool(TOOL_SELECT);
      if (id === null) return;
      onCreated(id);
    },
    [canEdit, camera, doc, identity, onCreated, tools, undoController],
  );

  /** A sticky at the middle of what is on screen: the rail's button, and `N`. */
  const createStickyCentre = useCallback((): void => {
    if (!canEdit) return;
    const world = screenToWorld(camera, {
      x: typeof window === 'undefined' ? 640 : window.innerWidth / 2,
      y: typeof window === 'undefined' ? 400 : window.innerHeight / 2,
    });
    // A new note is one undo step, closed before and after the single model call.
    undoController.boundary();
    const id = createSticky(doc, world);
    undoController.boundary();
    if (id) onCreated(id);
  }, [canEdit, camera, doc, onCreated, undoController]);

  // The keyboard is given the tool as well as the selection: `V`, `T` and `N` are three
  // of the rail's buttons, and Escape puts the tool back.
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit,
    undo: undoController,
    tool: tools.tool,
    onTool: tools.setTool,
    onCreateSticky: createStickyCentre,
  });

  const onEmptyDoubleClick = useCallback(
    (screen: Point): void => {
      if (!canEdit) return;
      // The tool says what a click means: a double-click with Text up writes text
      // rather than slapping a note down where the person meant to type.
      if (tools.isText) {
        placeText(screen);
        return;
      }
      const id = createSticky(doc, screenToWorld(camera, screen));
      if (id) onCreated(id);
    },
    [canEdit, camera, doc, onCreated, tools, placeText],
  );

  // A click on empty board space clears the selection. (When editing, the editor
  // already ended on the same pointerdown, so this is a no-op then.) With the Text tool
  // up it means something else entirely: *here* is where the text goes.
  const onEmptyClick = useCallback(
    (screen: Point): void => {
      if (tools.isText) {
        placeText(screen);
        return;
      }
      selection.clear();
    },
    [selection, tools, placeText],
  );

  // Closing a note's text editor: 'selected' is Escape (the note keeps the selection),
  // 'unselected' is a press somewhere else (that press decides the selection).
  const endObjectEdit = useCallback(
    (id: string, next: 'selected' | 'unselected'): void => {
      selection.endEdit();
      if (next === 'selected') selection.click(id);
    },
    [selection],
  );

  // A board that goes out of reach while a note is open on the screen closes it: the
  // editor would otherwise keep taking typing into a document nothing saves.
  useEffect(() => {
    if (!canEdit) selection.clear();
  }, [canEdit, selection]);

  // So the e2e suite can read the connection state as well as the badge.
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  const marqueeHandlers: MarqueeHandlers = {
    begin: marquee.begin,
    move: marquee.move,
    end: () => marquee.end(),
    cancel: marquee.cancel,
  };

  // A board that could not be read has no selection to draw a box around, so Shift
  // there does what it did before story 7: nothing but the rectangle's absence.
  const marqueeForViewport: MarqueeHandlers | undefined = canEdit ? marqueeHandlers : undefined;

  return (
    <BoardViewport
      chrome={
        <BoardChrome
          doc={doc}
          boardId={boardId}
          objects={objects}
          selection={selection}
          gesture={gesture}
          marquee={marquee}
          onCamera={setCamera}
          onCreateSticky={createStickyCentre}
          tool={tools.tool}
          onTool={tools.setTool}
          shapeKind={tools.shapeKind}
          onShapeKind={tools.setShapeKind}
          onDeleteSelection={deleteSelection}
          connectionState={connectionState}
          canEdit={canEdit}
          undoController={undoController}
          undo={undoState}
        />
      }
      onEmptyClick={onEmptyClick}
      onEmptyDoubleClick={onEmptyDoubleClick}
      marquee={marqueeForViewport}
      textToolActive={tools.isText}
      overlay={
        tools.isShape ? (
          <ShapeTool
            doc={doc}
            camera={camera}
            kind={tools.shapeKind}
            onCreated={tools.toolCreated}
            onCancelled={tools.reset}
            undo={undoController}
          />
        ) : tools.isConnector ? (
          <ConnectorTool
            doc={doc}
            camera={camera}
            snapshot={objects}
            onCreated={tools.toolCreated}
            onCancelled={tools.reset}
            undo={undoController}
          />
        ) : undefined
      }
    >
      <BoardObjects
        doc={doc}
        objects={objects}
        selection={selection}
        gesture={gesture}
        canEdit={canEdit}
        endObjectEdit={endObjectEdit}
        undo={undoController}
      />
    </BoardViewport>
  );
}

/** Screen-space chrome: rail, share panel, zoom controls, hint, and the selection's own UI. */
function BoardChrome({
  doc,
  boardId,
  objects,
  selection,
  gesture,
  marquee,
  onCamera,
  onCreateSticky,
  tool,
  onTool,
  shapeKind,
  onShapeKind,
  onDeleteSelection,
  connectionState,
  canEdit,
  undoController,
  undo,
}: {
  doc: Y.Doc;
  boardId: string;
  objects: readonly BoardObject[];
  selection: UseSelectionResult;
  gesture: TransformGestureHandlers;
  marquee: MarqueeState;
  onCamera(camera: Camera): void;
  onCreateSticky(): void;
  tool: Tool;
  onTool(tool: Tool): void;
  /** Which shape the Shape tool draws next (`shape.kind_menu`). */
  shapeKind: ShapeKind;
  onShapeKind(kind: ShapeKind): void;
  onDeleteSelection(): void;
  connectionState: ConnectionState;
  canEdit: boolean;
  undoController: UndoController;
  undo: UseUndoResult;
}): ReactNode {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();

  // Publish the camera upward: the board above needs it to turn screen pixels into
  // world units (the viewport owns the camera, and measures itself).
  useEffect(() => {
    onCamera(camera);
  }, [camera, onCamera]);

  return (
    <>
      <Toolbar
        onCreateSticky={onCreateSticky}
        tool={tool}
        onTool={onTool}
        shapeKind={shapeKind}
        onShapeKind={onShapeKind}
        disabled={!canEdit}
        undo={undo}
      />
      <SharePanel boardId={boardId} />
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomInWith(camera)}
        canZoomOut={canZoomOutWith(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        doc={doc}
        onDelete={onDeleteSelection}
        undo={undoController}
      />
      <MarqueeRect rect={marquee.rect} camera={camera} />
    </>
  );
}

/** The objects, drawn in world space by whatever the registry holds for their kind. */
function BoardObjects({
  doc,
  objects,
  selection,
  gesture,
  canEdit,
  endObjectEdit,
  undo,
}: {
  doc: Y.Doc;
  objects: readonly BoardObject[];
  selection: UseSelectionResult;
  gesture: TransformGestureHandlers;
  canEdit: boolean;
  endObjectEdit(id: string, next: 'selected' | 'unselected'): void;
  undo: UndoController;
}): ReactNode {
  const { camera } = useBoardCamera();
  return (
    <>
      {objects.map((object) => {
        // A kind this screen has no registry entry for is not drawn at all — and so is
        // not selectable either (TC-08, TC-12).
        const spec = getObjectType(object.type);
        if (!spec) return null;
        const Component = spec.Component;
        return (
          <Component
            key={object.id}
            object={object}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(object.id)}
            editing={object.id === selection.editingId}
            editable={canEdit}
            onObjectPointerDown={gesture.onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={(next: 'selected' | 'unselected'): void => {
              endObjectEdit(object.id, next);
            }}
            undo={undo}
          />
        );
      })}
    </>
  );
}

/** The camera before the viewport has measured itself: the board's own start point. */
const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
