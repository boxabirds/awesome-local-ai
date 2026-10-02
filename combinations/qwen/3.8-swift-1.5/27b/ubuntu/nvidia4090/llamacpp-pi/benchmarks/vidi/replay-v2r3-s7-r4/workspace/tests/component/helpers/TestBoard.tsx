import { useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { screenToWorld } from '../../../src/client/canvas/camera';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useMarquee } from '../../../src/client/board/useMarquee';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { getObjectType } from '../../../src/client/objects/registry';
import { SelectionOverlay } from '../../../src/client/objects/SelectionOverlay';
import { SelectionBar } from '../../../src/client/objects/SelectionBar';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  moveObjects,
  allObjectIds,
  type ObjectSnapshot,
} from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';

export interface TestBoardProps {
  camera: Camera;
  viewportSize: Size;
  /** Called with the board doc once available (so tests can create/assert notes). */
  onDocReady?: (doc: Y.Doc) => void;
  beginPan?: (p: Point) => void;
  panMove?: (p: Point) => void;
  endPan?: () => void;
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  /** Story 4 gate: when false, no writes (move/resize/delete/nudge) happen. */
  canEdit?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

/**
 * A test harness that mirrors the Board component of stories 1–7: real
 * Y.Doc, registry-rendered objects, multi-selection, marquee, transform
 * gesture and the board keyboard — but with a fixed camera and viewport so
 * tests are deterministic. Object types are whatever has been registered
 * (the test-only `testbox` type comes from tests/fixtures/testbox.tsx).
 */
export function TestBoard({
  camera,
  viewportSize,
  onDocReady,
  beginPan,
  panMove,
  endPan,
  wheel,
  canEdit = true,
  onGestureStart,
  onGestureEnd,
}: TestBoardProps): React.ReactElement {
  const { doc, objects } = useBoardDoc();
  const sel = useSelection(objects);

  useEffect(() => {
    onDocReady?.(doc);
  }, [doc, onDocReady]);

  const objectsRef = useRef<readonly ObjectSnapshot[]>(objects);
  objectsRef.current = objects;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const selRef = useRef(sel);
  selRef.current = sel;

  const toWorld = useCallback(
    (clientX: number, clientY: number) => screenToWorld(cameraRef.current, { x: clientX, y: clientY }),
    [],
  );
  const getSnapshot = useCallback(() => objectsRef.current, []);

  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const gesture = useTransformGesture({
    doc,
    toWorld,
    getSnapshot,
    getSelection: () => selRef.current.ids,
    isEditing: (id) => selRef.current.editingId === id,
    onSelect: (id) => selRef.current.click(id),
    canEdit: () => canEditRef.current,
    onGestureStart: () => onGestureStartRef.current?.(),
    onGestureEnd: () => onGestureEndRef.current?.(),
  });

  const marquee = useMarquee({
    toWorld,
    toScreen: (p) => ({
      x: (p.x - cameraRef.current.x) * cameraRef.current.zoom,
      y: (p.y - cameraRef.current.y) * cameraRef.current.zoom,
    }),
    zoom: () => cameraRef.current.zoom,
    getSnapshot,
    onSelect: (ids, additive) => selRef.current.setMany(ids, additive),
  });

  const createAtScreen = useCallback(
    (p: Point) => {
      const w = screenToWorld(cameraRef.current, p);
      const id = createSticky(doc, w);
      if (id) selRef.current.startEdit(id);
    },
    [doc],
  );

  const createAtCenter = useCallback(() => {
    createAtScreen({ x: viewportSize.width / 2, y: viewportSize.height / 2 });
  }, [createAtScreen, viewportSize.width, viewportSize.height]);

  const handleDeleteSelection = useCallback(() => {
    if (!canEditRef.current) return;
    const ids = [...selRef.current.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    selRef.current.clear();
  }, [doc]);

  const handleColor = useCallback(
    (id: string, color: string) => {
      setStickyColor(doc, id, color as StickyColor);
    },
    [doc],
  );

  const handleNudge = useCallback(
    (dx: number, dy: number) => {
      if (!canEditRef.current) return;
      const positions = new Map<string, Point>();
      for (const o of objectsRef.current) {
        if (selRef.current.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
      }
      if (positions.size > 0) moveObjects(doc, positions);
    },
    [doc],
  );

  const handleStartEditingSelection = useCallback(() => {
    const ids = [...selRef.current.ids];
    if (ids.length !== 1) return;
    const obj = objectsRef.current.find((o) => o.id === ids[0]);
    if (obj && getObjectType(obj.type)?.editableText) selRef.current.startEdit(ids[0]);
  }, []);

  useBoardKeys({
    selectAll: () => selRef.current.setMany(allObjectIds(objectsRef.current), false),
    clear: () => selRef.current.clear(),
    deleteSelection: handleDeleteSelection,
    nudge: handleNudge,
    startEditingSelection: handleStartEditingSelection,
    cancelGesture: gesture.cancelGesture,
    isEditing: () => selRef.current.editingId !== null,
    isGestureActive: gesture.isGestureActive,
  });

  // Stable render order (by id) so z-changes only affect z-index, never DOM order.
  const orderedObjects = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selectedObjects = objects.filter((o) => sel.ids.has(o.id));
  const showSelectionBar =
    selectedObjects.length > 0 && sel.editingId === null && !gesture.active;

  const toScreen = useCallback(
    (p: Point) => ({
      x: (p.x - cameraRef.current.x) * cameraRef.current.zoom,
      y: (p.y - cameraRef.current.y) * cameraRef.current.zoom,
    }),
    [],
  );

  return (
    <div>
      <BoardViewport
        camera={camera}
        beginPan={beginPan ?? (() => {})}
        panMove={panMove ?? (() => {})}
        endPan={endPan ?? (() => {})}
        wheel={wheel ?? (() => {})}
        onCreateStickyAt={createAtScreen}
        onClearSelection={() => selRef.current.clear()}
        interceptPointerDown={(e) => {
          if (e.shiftKey) {
            marquee.begin(e);
            return true;
          }
          return false;
        }}
        marqueeScreenRect={marquee.screenRect}
      >
        {orderedObjects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const C = spec.Component;
          return (
            <C
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={sel.ids.has(obj.id)}
              editing={sel.editingId === obj.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        objects={selectedObjects}
        toScreen={toScreen}
        zoom={camera.zoom}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {showSelectionBar && (
        <SelectionBar objects={selectedObjects} onDelete={handleDeleteSelection} onColor={handleColor} />
      )}
      <Toolbar onCreateSticky={createAtCenter} />
    </div>
  );
}

