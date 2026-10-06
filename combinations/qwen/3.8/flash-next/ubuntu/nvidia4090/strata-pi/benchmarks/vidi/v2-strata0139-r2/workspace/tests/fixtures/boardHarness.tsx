import { createElement, useMemo, useRef, type MutableRefObject } from "react";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { BoardViewport, CameraApiContext } from "../../src/client/canvas/BoardViewport";
import { useCamera, useWindowSize } from "../../src/client/canvas/useCamera";
import type { Camera } from "../../src/client/canvas/camera";
import { useBoardDoc } from "../../src/client/board/useBoardDoc";
import { endEditNext, useSelection, type SelectionApi } from "../../src/client/board/useSelection";
import { useTransformGesture } from "../../src/client/board/useTransformGesture";
import { MarqueeRect, useMarquee } from "../../src/client/board/Marquee";
import { useBoardKeys } from "../../src/client/board/useBoardKeys";
import { SelectionOverlay } from "../../src/client/board/SelectionOverlay";
import { SelectionBar } from "../../src/client/board/SelectionBar";
import { getObjectType, registeredObjectTypes } from "../../src/client/objects/registry";
import { deleteObjects } from "../../src/shared/board-model";

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
}

export function BoardHarness({
  doc,
  canEdit,
  overridesRef,
  handleRef,
  gestures,
}: {
  doc: Y.Doc;
  canEdit: boolean;
  overridesRef: MutableRefObject<HarnessOverrides>;
  handleRef: MutableRefObject<HarnessHandle | null>;
  /** Story 8's undo gesture window; counted here to prove it opens and closes once. */
  gestures?: { onStart(): void; onEnd(): void };
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
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: visible,
    canEdit,
    onGestureStart: gestures?.onStart,
    onGestureEnd: gestures?.onEnd,
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
  });

  handleRef.current = {
    selection: () => selection,
    setOverrides: (byId) => {
      overridesRef.current = { byId };
    },
  };

  const paintOrder = useMemo(() => visible.slice().sort((a, b) => (a.id < b.id ? -1 : 1)), [visible]);

  return (
    <CameraApiContext.Provider value={board}>
      <BoardViewport
        onCreateAtPoint={() => undefined}
        onEmptyClick={() => selection.clear()}
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
              onDelete={() => {
                const ids = Array.from(selection.ids);
                if (ids.length === 0) return;
                deleteObjects(doc, ids);
                selection.clear();
              }}
            />
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
