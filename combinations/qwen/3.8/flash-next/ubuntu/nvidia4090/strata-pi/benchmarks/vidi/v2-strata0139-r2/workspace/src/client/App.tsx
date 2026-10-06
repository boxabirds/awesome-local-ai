import { createElement, useCallback, useMemo, useRef } from "react";
import type * as Y from "yjs";
import { BoardViewport, CameraApiContext } from "./canvas/BoardViewport";
import { NavigationHint } from "./canvas/NavigationHint";
import { ZoomControls } from "./canvas/ZoomControls";
import { useCamera, useWindowSize } from "./canvas/useCamera";
import type { Camera, Point as CameraPoint } from "./canvas/camera";
import { screenToWorld } from "./canvas/camera";
import { useBoardDoc } from "./board/useBoardDoc";
import { endEditNext, useSelection } from "./board/useSelection";
import { useTransformGesture } from "./board/useTransformGesture";
import { useMarquee, MarqueeRect } from "./board/Marquee";
import { useBoardKeys } from "./board/useBoardKeys";
import { UndoControllerContext, useUndo, useUndoHistory } from "./board/useUndo";
import { SelectionOverlay } from "./board/SelectionOverlay";
import { SelectionBar } from "./board/SelectionBar";
import { Toolbar } from "./board/Toolbar";
import { getObjectType, registeredObjectTypes } from "./objects/registry";
import { ConnectionStatus } from "./sync/ConnectionStatus";
import { SharePanel } from "./pages/SharePanel";
import { useConnectionTestHook } from "./sync/testHook";
import { createSticky, deleteObjects } from "../shared/board-model";

/**
 * The board: camera (story 1), objects (story 2), the live room (story 3), the
 * board link (story 5) — and story 7's selection: selecting many objects at once
 * and moving, resizing, nudging and deleting them together.
 *
 * Everything story 7 adds is wired here and nowhere else: one selection, one
 * transform gesture, one marquee, one keyboard. Each board object is rendered by
 * the type's own component from the registry, with the same props whatever kind
 * of object it is — which is what makes selection, moving and resizing apply to
 * every type without this file knowing what a sticky note is.
 *
 * `doc` can be injected (component tests); `boardId` is the board this screen
 * connects to — without it the document stays local to this tab.
 */
export interface AppProps {
  doc?: Y.Doc;
  boardId?: string;
  /**
   * False when this board could not be loaded (story 4): no gesture and no
   * keyboard shortcut writes to it (TC-25). This repo's `ConnectionState` has no
   * "could not load" state — a failed board load is reported through the board's
   * HTTP API and the room, not through the live connection — so whether a board
   * is editable arrives here as a parameter and is passed on to the gesture and
   * the keyboard, which is where it is honoured.
   */
  canEdit?: boolean;
}

export function App({ doc: providedDoc, boardId, canEdit = true }: AppProps = {}) {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const { doc, objects, connectionState } = useBoardDoc({ doc: providedDoc, boardId });

  const camera: Camera = board.camera;
  // Only types this client has a component for can be selected, moved, resized
  // or deleted: an unknown object stays exactly where it is.
  const selectableTypes = useMemo(() => registeredObjectTypes(), []);
  const visible = useMemo(
    () => objects.filter((object) => getObjectType(object.type) !== undefined),
    [objects],
  );

  const selection = useSelection(visible);
  // Story 8: one history for this board document, and it belongs to this tab.
  const undo = useUndoHistory(doc);
  const undoState = useUndo(undo, canEdit);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: visible,
    canEdit,
    // A gesture is one undo step: the capture window opens at the first real
    // move and closes when the pointer lets go (or the gesture is cancelled), so
    // every per-frame write in between belongs to the same step.
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });
  const marquee = useMarquee(
    camera,
    visible,
    useCallback((ids: string[], additive: boolean) => selection.setMany(ids, additive), [selection]),
    selectableTypes,
  );
  useBoardKeys({
    doc,
    selection,
    snapshot: visible,
    selectableTypes,
    canEdit,
    marquee: { active: () => marquee.active(), cancel: () => marquee.cancel() },
    undo,
  });
  useConnectionTestHook(connectionState);

  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  /** Creates a note centred on a screen point and starts typing in it. */
  const createAtScreenPoint = useCallback(
    (point: CameraPoint) => {
      if (!canEdit) return;
      const world = screenToWorld(cameraRef.current, point);
      // One created note is one undo step, whatever was done just before it.
      undo.boundary();
      const id = createSticky(doc, world);
      undo.boundary();
      if (typeof id !== "string") return;
      selection.startEdit(id);
    },
    [canEdit, doc, selection, undo],
  );

  /** The Sticky note tool: centred in the middle of the visible board area. */
  const createAtViewportCentre = useCallback(() => {
    const centre: CameraPoint = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    createAtScreenPoint(centre);
  }, [createAtScreenPoint, viewportSize.width, viewportSize.height]);

  /** Empty board space: nothing is selected and nothing is being typed in. */
  const clearSelection = useCallback(() => selection.clear(), [selection]);

  const deleteSelection = useCallback(() => {
    const ids = Array.from(selection.ids);
    if (ids.length === 0) return;
    // Deleting a whole selection is one step, not one per object.
    undo.boundary();
    deleteObjects(doc, ids);
    undo.boundary();
    selection.clear();
  }, [doc, selection, undo]);

  // Objects are painted in a stable order (by id) and stacked with CSS z-index.
  // Re-sorting the React children whenever z changes would re-parent the object
  // being dragged, and removing an element from the document releases its
  // pointer capture: the drag would silently end halfway through.
  const paintOrder = useMemo(() => visible.slice().sort((a, b) => (a.id < b.id ? -1 : 1)), [visible]);

  return (
    <UndoControllerContext.Provider value={undo}>
    <CameraApiContext.Provider value={board}>
      <BoardViewport
        onCreateAtPoint={createAtScreenPoint}
        onEmptyClick={clearSelection}
        marquee={marquee}
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={visible}
              camera={camera}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
            <SelectionBar
              ids={selection.ids}
              snapshot={visible}
              camera={camera}
              onDelete={deleteSelection}
            />
          </>
        }
      >
        {paintOrder.map((object) => {
          const spec = getObjectType(object.type);
          if (!spec) return null;
          return createElement(spec.Component, {
            key: object.id,
            object,
            doc,
            zoom: camera.zoom,
            selected: selection.ids.has(object.id),
            editing: selection.editingId === object.id,
            dragging: gesture.draggingIds.has(object.id),
            onObjectPointerDown: gesture.onObjectPointerDown,
            onStartEdit: selection.startEdit,
            onEndEdit: (next: "selected" | "unselected") => endEditNext(selection, next),
          });
        })}
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>

      <Toolbar onCreateSticky={createAtViewportCentre} undo={undoState} />
      <ZoomControls
        zoomPercent={board.zoomPercent}
        canZoomIn={board.canZoomIn}
        canZoomOut={board.canZoomOut}
        onZoomIn={() => board.zoomStep("in")}
        onZoomOut={() => board.zoomStep("out")}
        onReset={board.reset}
      />
      <NavigationHint visible={!board.hasNavigated} />
      <ConnectionStatus state={connectionState} />
      {/* Story 5: a board you are on is a board you can send somebody. */}
      {boardId !== undefined && <SharePanel boardId={boardId} />}
    </CameraApiContext.Provider>
    </UndoControllerContext.Provider>
  );
}
