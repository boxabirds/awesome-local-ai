import { createElement, useCallback, useMemo, useRef, type MutableRefObject } from "react";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { BoardViewport, CameraApiContext } from "../../src/client/canvas/BoardViewport";
import { useCamera, useWindowSize } from "../../src/client/canvas/useCamera";
import type { Camera } from "../../src/client/canvas/camera";
import { screenToWorld } from "../../src/client/canvas/camera";
import { useBoardDoc } from "../../src/client/board/useBoardDoc";
import { endEditNext, useSelection, type SelectionApi } from "../../src/client/board/useSelection";
import { useTransformGesture } from "../../src/client/board/useTransformGesture";
import { MarqueeRect, useMarquee } from "../../src/client/board/Marquee";
import { useBoardKeys } from "../../src/client/board/useBoardKeys";
import { useActiveTool } from "../../src/client/tools/useActiveTool";
import { ShapeTool } from "../../src/client/tools/ShapeTool";
import { ConnectorTool } from "../../src/client/tools/ConnectorTool";
import { SelectionOverlay } from "../../src/client/board/SelectionOverlay";
import { SelectionBar } from "../../src/client/board/SelectionBar";
import { UndoControllerContext, useUndoHistory } from "../../src/client/board/useUndo";
import type { UndoController } from "../../src/client/board/undo";
import { getObjectType, registeredObjectTypes } from "../../src/client/objects/registry";
import { deleteObjects } from "../../src/shared/board-model";
import { createText } from "../../src/shared/objects/text";
import { connectorLine, type ConnectorSnap } from "../../src/shared/objects/connector";
import { distanceToPolyline } from "../../src/shared/geometry/connector-geometry";
import { CONNECTOR_HIT_TOLERANCE_PX } from "../../src/shared/config";

/**
 * The board the component tests mount.
 *
 * By default this is the real `App`. With `canEdit` or `extraProps` it is this
 * harness instead, which wires the very same hooks (`useSelection`,
 * `useTransformGesture`, `useMarquee`, `useBoardKeys`, the registry) and differs
 * in two test-only ways: it can report a board this client may not write to
 * (TC-25 — a `load_failed` board is produced by the storage test hooks, which no
 * component test can reach), and it can give one object props that its registered
 * type does not have (TC-24 — a minimum size that is not 50, to show the limit
 * comes from the registry and not from a constant).
 *
 * Neither option belongs in production code, so neither is a prop of `App`.
 */

export interface HarnessOverrides {
  /** Extra props merged into one object component's props, by object id. */
  byId: Record<string, Record<string, unknown>>;
}

export interface HarnessHandle {
  selection(): SelectionApi;
  setOverrides(overrides: Record<string, Record<string, unknown>>): void;
  /** Story 8: this board's undo history, for tests that assert on its stacks. */
  undo(): UndoController;
}

export function BoardHarness({
  doc,
  canEdit,
  overridesRef,
  handleRef,
  gestures,
  undo,
}: {
  doc: Y.Doc;
  canEdit: boolean;
  overridesRef: MutableRefObject<HarnessOverrides>;
  handleRef: MutableRefObject<HarnessHandle | null>;
  /** Story 8's undo gesture window; counted here to prove it opens and closes once. */
  gestures?: { onStart(): void; onEnd(): void };
  /**
   * Story 8: a history of this board's own is created here unless the test hands
   * one in — a fake is how the shortcut tests prove which calls the keyboard makes.
   */
  undo?: UndoController;
}) {
  const viewportSize = useWindowSize();
  const board = useCamera(viewportSize);
  const camera: Camera = board.camera;
  const { objects } = useBoardDoc({ doc });
  const selectableTypes = useMemo(() => registeredObjectTypes(), []);
  const visible = useMemo(
    () => objects.filter((object) => getObjectType(object.type) !== undefined),
    [objects],
  );

  const selection = useSelection(visible);
  // Story 9: the same tool state the real board has — story 10's tools included.
  const tool = useActiveTool({ canEdit, select: (id) => selection.click(id) });
  const createTextAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!canEdit) return;
      const id = createText(doc, screenToWorld(camera, point));
      if (typeof id !== "string") return;
      tool.setTool("select");
      selection.startEdit(id);
    },
    [canEdit, camera, doc, selection, tool],
  );
  const ownHistory = useUndoHistory(doc);
  const controller = undo ?? ownHistory;
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: visible,
    canEdit,
    // Story 8: a gesture is one undo step, and the story 7 test still counts
    // the window opening and closing exactly once.
    onGestureStart: () => {
      controller.boundary();
      gestures?.onStart();
    },
    onGestureEnd: () => {
      controller.boundary();
      gestures?.onEnd();
    },
  });
  const marquee = useMarquee(
    camera,
    visible,
    (ids, additive) => selection.setMany(ids, additive),
    selectableTypes,
  );
  useBoardKeys({
    doc,
    selection,
    snapshot: visible,
    selectableTypes,
    canEdit,
    marquee: { active: () => marquee.active(), cancel: () => marquee.cancel() },
    undo: controller,
    tool,
  });

  handleRef.current = {
    selection: () => selection,
    setOverrides: (byId) => {
      overridesRef.current = { byId };
    },
    undo: () => controller,
  };

  const paintOrder = useMemo(() => visible.slice().sort((a, b) => (a.id < b.id ? -1 : 1)), [visible]);

  // A selected arrow's ends can be re-attached in Select mode as well.
  const selectedConnectorIds = useMemo(
    () => visible.filter((object) => object.type === "connector" && selection.ids.has(object.id)).map((object) => object.id),
    [selection.ids, visible],
  );

  /** Empty board space, except near an arrow's line, which selects it. */
  const emptyBoardClick = (point: { x: number; y: number }): void => {
    const world = screenToWorld(camera, point);
    const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (camera.zoom > 0 ? camera.zoom : 1);
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const object = visible[index];
      if (object.type !== "connector" || object.from === undefined || object.to === undefined) continue;
      const line = connectorLine(object as ConnectorSnap, visible);
      if (distanceToPolyline([line.from, line.to], world, tolerance) <= tolerance) {
        selection.click(object.id);
        return;
      }
    }
    selection.clear();
  };

  return (
    <UndoControllerContext.Provider value={controller}>
    <CameraApiContext.Provider value={board}>
      <BoardViewport
        onCreateAtPoint={() => undefined}
        onEmptyClick={emptyBoardClick}
        marquee={marquee}
        tool={tool.tool}
        onTextCreate={createTextAtScreenPoint}
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
              onDelete={() => {
                const ids = Array.from(selection.ids);
                if (ids.length === 0) return;
                deleteObjects(doc, ids);
                selection.clear();
              }}
            />
            {tool.tool === "shape" ? (
              <ShapeTool
                doc={doc}
                kind={tool.shapeKind}
                fill={tool.fill}
                stroke={tool.stroke}
                camera={camera}
                canEdit={canEdit}
                onGestureBoundary={controller.boundary}
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
                onGestureBoundary={controller.boundary}
                onCreated={tool.toolCreated}
              />
            ) : null}
          </>
        }
      >
        {paintOrder.map((object) => {
          const spec = getObjectType(object.type);
          if (!spec) return null;
          return createElement(spec.Component, {
            key: object.id,
            ...overridesRef.current.byId[object.id],
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
    </CameraApiContext.Provider>
    </UndoControllerContext.Provider>
  );
}

/** The real board, or the harness when a test needs one of its two options. */
export function BoardUnderTest({
  doc,
  canEdit,
  overridesRef,
  handleRef,
}: {
  doc: Y.Doc;
  canEdit?: boolean;
  overridesRef: MutableRefObject<HarnessOverrides>;
  handleRef: MutableRefObject<HarnessHandle | null>;
}) {
  if (Object.keys(overridesRef.current.byId).length === 0) {
    return <App doc={doc} canEdit={canEdit} />;
  }
  return (
    <BoardHarness
      doc={doc}
      canEdit={canEdit ?? true}
      overridesRef={overridesRef}
      handleRef={handleRef}
    />
  );
}

/** Kept for tests that want the harness explicitly. */
export function useHarnessRefs(): {
  overridesRef: MutableRefObject<HarnessOverrides>;
  handleRef: MutableRefObject<HarnessHandle | null>;
} {
  const overridesRef = useRef<HarnessOverrides>({ byId: {} });
  const handleRef = useRef<HarnessHandle | null>(null);
  return { overridesRef, handleRef };
}
