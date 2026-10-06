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
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: visible,
    canEdit,
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
  });
  useConnectionTestHook(connectionState);

  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  /** Creates a note centred on a screen point and starts typing in it. */
  const createAtScreenPoint = useCallback(
    (point: CameraPoint) => {
      if (!canEdit) return;
      const world = screenToWorld(cameraRef.current, point);
      const id = createSticky(doc, world);
      if (typeof id !== "string") return;
      selection.startEdit(id);
    },
    [canEdit, doc, selection],
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
    deleteObjects(doc, ids);
    selection.clear();
  }, [doc, selection]);

  // Objects are painted in a stable order (by id) and stacked with CSS z-index.
  // Re-sorting the React children whenever z changes would re-parent the object
  // being dragged, and removing an element from the document releases its
  // pointer capture: the drag would silently end halfway through.
  const paintOrder = useMemo(() => visible.slice().sort((a, b) => (a.id < b.id ? -1 : 1)), [visible]);

  return (
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

      <Toolbar onCreateSticky={createAtViewportCentre} />
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
  );
}
