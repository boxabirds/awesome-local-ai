import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useActiveTool } from "./tools/useActiveTool";
import { ShapeTool } from "./tools/ShapeTool";
import { ConnectorTool } from "./tools/ConnectorTool";
import { PenTool } from "./tools/PenTool";
import { PenToolbar } from "./tools/PenToolbar";
import { usePenOptions } from "./tools/usePenOptions";
import { UndoControllerContext, useUndo, useUndoHistory } from "./board/useUndo";
import { SelectionOverlay } from "./board/SelectionOverlay";
import { SelectionBar } from "./board/SelectionBar";
import { Toolbar } from "./board/Toolbar";
import { getObjectType, registeredObjectTypes } from "./objects/registry";
import { ConnectionStatus } from "./sync/ConnectionStatus";
import { SharePanel } from "./pages/SharePanel";
import { useConnectionTestHook } from "./sync/testHook";
import { isTestMode, type Vidi6TestApi } from "./canvas/testHooks";
import { useImageInsert } from "./images/useImageInsert";
import { DropHighlight } from "./images/DropHighlight";
import { ImageContextProvider, type ImageContextValue } from "./objects/ImageObject";
import { ToastHost } from "./ui/Toast";
import { createSticky, deleteObjects } from "../shared/board-model";
import { createText, setTextSize } from "../shared/objects/text";
import { connectorLine, type ConnectorSnap } from "../shared/objects/connector";
import { distanceToPolyline } from "../shared/geometry/connector-geometry";
import { CONNECTOR_HIT_TOLERANCE_PX, IMAGE_UPLOAD_CLOCK_MS, type TextSize } from "../shared/config";
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

/** A stable id for this tab, for `createdBy` until story 14 gives identities. */
function tabIdentity(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `tab-${Math.random().toString(36).slice(2, 12)}`;
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
  // Story 9: which tool the board is in. One state, shared by the toolbar buttons,
  // the keyboard and the viewport's click. Story 10 widens it to Shape and
  // Connector, and gives it the selection so that what a tool creates is what is
  // selected next.
  const tool = useActiveTool({
    canEdit,
    select: useCallback((id: string) => selection.click(id), [selection]),
  });
  // Story 11: the pen's colour and thickness — this tab's choice, never board
  // content, so it is not synced and not undoable.
  const pen = usePenOptions();
  // Who drew something. Story 14 is where a person gets an identity; until then a
  // stroke records the tab that drew it, which is all this build can honestly say.
  const identityRef = useRef<string | null>(null);
  if (identityRef.current === null) identityRef.current = tabIdentity();
  const identityId = identityRef.current;
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
  useConnectionTestHook(connectionState);

  /**
   * Story 12 (`image.insert`): drop, paste and the file picker all end up here.
   * The hook owns the placeholders it created, the uploads they started, the
   * progress they report and the files Retry needs.
   */
  const insert = useImageInsert({
    doc,
    boardId: boardId ?? "",
    camera,
    connection: connectionState,
    identityId,
    canEdit,
    viewportSize: { width: viewportSize.width, height: viewportSize.height },
  });
  const insertRef = useRef(insert);
  insertRef.current = insert;

  /** `image.pick`: the Image tool is not a mode the board waits in. */
  const activeTool = tool.tool;
  const setTool = tool.setTool;
  const pickerOpenedRef = useRef(false);
  useEffect(() => {
    if (activeTool !== "image") {
      pickerOpenedRef.current = false;
      return;
    }
    // One arming is one picker. `StrictMode` runs the same effect twice on mount,
    // and a second file dialog behind the first is worse than no dialog at all.
    if (pickerOpenedRef.current) return;
    pickerOpenedRef.current = true;
    insertRef.current.openPicker();
    // Whatever the picker answers, the board is back in Select (`tools.active_tool`).
    setTool("select");
  }, [activeTool, setTool]);

  /** Remove is the one control a placeholder always has (`image.upload_failure`). */
  const removeImage = useCallback(
    (id: string) => {
      if (!canEdit) return;
      undo.boundary();
      deleteObjects(doc, [id]);
      undo.boundary();
      if (selection.ids.has(id)) selection.click(id);
    },
    [canEdit, doc, selection, undo],
  );

  /**
   * The board's shared clock: while any image is `uploading`, the board re-renders
   * every `IMAGE_UPLOAD_CLOCK_MS` so an abandoned upload becomes "Image upload
   * didn't finish" on its own, with nobody having to look at it (`image.unfinished`).
   */
  const [uploadClock, setUploadClock] = useState(() => Date.now());
  // The dependency is a boolean, not the object list: an effect that re-ran on
  // every render would set state on every render, and a board with an uploading
  // image would re-render forever.
  const anyUploading = visible.some((object) => object.type === "image" && object.status === "uploading");
  useEffect(() => {
    if (!anyUploading) return;
    const timer = setInterval(() => setUploadClock(Date.now()), IMAGE_UPLOAD_CLOCK_MS);
    return () => clearInterval(timer);
  }, [anyUploading]);

  const imageContext = useMemo<ImageContextValue>(
    () => ({
      identityId,
      progress: insert.progress,
      canRetry: insert.canRetry,
      onRetry: (id: string) => insertRef.current.retry(id),
      onRemove: removeImage,
      now: uploadClock,
    }),
    [identityId, insert.progress, insert.canRetry, removeImage, uploadClock],
  );

  // Which identity this screen writes as (test builds only): the same id the
  // placeholder's `uploaderId` is compared against.
  useEffect(() => {
    if (!isTestMode()) return;
    const api = (window.__vidi6 ?? {}) as Vidi6TestApi;
    api.identityId = identityId;
    window.__vidi6 = api;
  }, [identityId]);

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

  /**
   * The Text tool (story 9): text written at the point that was clicked, its top
   * left corner under the cursor, straight into editing. The tool is left behind
   * on the way, so the click that created this text cannot create another one.
   */
  const createTextAtScreenPoint = useCallback(
    (point: CameraPoint) => {
      if (!canEdit) return;
      const world = screenToWorld(cameraRef.current, point);
      // One created text object is one undo step.
      undo.boundary();
      const id = createText(doc, world);
      undo.boundary();
      if (typeof id !== "string") return;
      tool.setTool("select");
      selection.startEdit(id);
    },
    [canEdit, doc, selection, tool, undo],
  );

  // The keyboard is wired last, because its tool keys and `N` reach the same
  // creation functions the toolbar buttons use.
  useBoardKeys({
    doc,
    selection,
    snapshot: visible,
    selectableTypes,
    canEdit,
    marquee: { active: () => marquee.active(), cancel: () => marquee.cancel() },
    undo,
    tool,
    onCreateSticky: createAtViewportCentre,
  });

  /**
   * A press and release on what looks like empty board space. Two things there are
   * not empty: an arrow, and a stroke's line. Both are thin, so a click close
   * enough to either selects it (`connector.select`, `pen.select`) even inside a box
   * that is mostly empty space, and a click farther away clears the selection as it
   * always has.
   */
  const emptyBoardClick = useCallback(
    (point: CameraPoint) => {
      const cameraNow = cameraRef.current;
      const world = screenToWorld(cameraNow, point);
      const zoom = cameraNow.zoom > 0 ? cameraNow.zoom : 1;
      const tolerance = CONNECTOR_HIT_TOLERANCE_PX / zoom;
      for (let index = visible.length - 1; index >= 0; index -= 1) {
        const object = visible[index];
        if (object.type === "stroke") {
          // The registry is what knows how a stroke is hit; the board only asks.
          if (getObjectType("stroke")?.hitTest(object, world, zoom) === true) {
            selection.click(object.id);
            return;
          }
          continue;
        }
        if (object.type !== "connector" || object.from === undefined || object.to === undefined) continue;
        const line = connectorLine(object as ConnectorSnap, visible);
        if (distanceToPolyline([line.from, line.to], world, tolerance) <= tolerance) {
          selection.click(object.id);
          return;
        }
      }
      selection.clear();
    },
    [selection, visible],
  );

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

  // A selected arrow can have its ends re-attached in Select mode too, so the
  // connector tool is present whenever a connector is selected.
  const selectedConnectorIds = useMemo(
    () => visible.filter((object) => object.type === "connector" && selection.ids.has(object.id)).map((object) => object.id),
    [selection.ids, visible],
  );

  return (
    <UndoControllerContext.Provider value={undo}>
    <CameraApiContext.Provider value={board}>
      <ImageContextProvider value={imageContext}>
      <BoardViewport
        onCreateAtPoint={createAtScreenPoint}
        onEmptyClick={emptyBoardClick}
        marquee={marquee}
        tool={tool.tool}
        onTextCreate={createTextAtScreenPoint}
        onFilesDragEnter={insert.onDragEnter}
        onFilesDragOver={insert.onDragOver}
        onFilesDragLeave={insert.onDragLeave}
        onFilesDrop={insert.onDrop}
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

              editingId={selection.editingId}
              onTextSize={(id: string, size: TextSize) => {
                // One size change is one undo step.
                undo.boundary();
                setTextSize(doc, id, size);
                undo.boundary();
              }}
            />
            {/* Story 10's tools draw in screen space over the board: the shape
                preview and the connector's dots are never scaled by the zoom. */}
            {tool.tool === "shape" ? (
              <ShapeTool
                doc={doc}
                kind={tool.shapeKind}
                fill={tool.fill}
                stroke={tool.stroke}
                camera={camera}
                canEdit={canEdit}
                onGestureBoundary={undo.boundary}
                onCreated={tool.toolCreated}
              />
            ) : null}
            {tool.tool === "connector" || selectedConnectorIds.length > 0 ? (
              <ConnectorTool
                doc={doc}
                camera={camera}
                zoom={camera.zoom}
                snapshot={visible}
                selectedConnectorIds={selectedConnectorIds}
                toolActive={tool.tool === "connector"}
                canEdit={canEdit}
                onGestureBoundary={undo.boundary}
                onCreated={tool.toolCreated}
              />
            ) : null}
            {/* Story 11: the pen draws its own preview in screen space, and keeps
                drawing after a stroke — the tool is not left behind. */}
            {tool.tool === "pen" ? (
              <PenTool
                camera={camera}
                color={pen.color}
                thickness={pen.thickness}
                doc={doc}
                identityId={identityId}
                canEdit={canEdit}
                onGestureBoundary={undo.boundary}
              />
            ) : null}
            {/* Story 12 (`image.drop`): the board saying "drop them here". */}
            <DropHighlight active={insert.dropActive} />
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
      </ImageContextProvider>

      <Toolbar
        onCreateSticky={createAtViewportCentre}
        undo={undoState}
        canEdit={canEdit}
        tool={tool}
        shapeKind={tool.shapeKind}
        onShapeKind={tool.setShapeKind}
      />
      {/* The pen's own options, beside the toolbar while the pen is armed. */}
      {tool.tool === "pen" ? (
        <PenToolbar color={pen.color} thickness={pen.thickness} onColor={pen.setColor} onThickness={pen.setThickness} />
      ) : null}
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
      {/* Story 12: the one place a refused file says why (`image.insert`). */}
      <ToastHost />
    </CameraApiContext.Provider>
    </UndoControllerContext.Provider>
  );
}
