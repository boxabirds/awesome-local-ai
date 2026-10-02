import { useState, useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { getObjectType } from '../../../src/client/objects/registry';
import { NoteToolbar } from '../../../src/client/objects/NoteToolbar';
import {
  createSticky,
  setStickyColor,
  deleteObjects,
  objectsInRect,
  objectBounds,
  type ObjectSnapshot,
} from '../../../src/shared/board-model';
import { type StickyColor } from '../../../src/shared/config';

export interface TestBoardProps {
  camera: Camera;
  viewportSize: Size;
  /** Called with the board doc once available (so tests can create/assert notes). */
  onDocReady?: (doc: Y.Doc) => void;
  beginPan?: (p: Point) => void;
  panMove?: (p: Point) => void;
  endPan?: () => void;
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  /** Viewers (canEdit = false) get no transform writes; default true. */
  canEdit?: boolean;
  /** Observes gesture start/end (used by TC-26). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

/**
 * A test harness that mirrors the real board: real Y.Doc, multi-selection,
 * registry-driven object rendering, transform gestures, marquee, selection
 * bar/overlay and keyboard commands — but with a fixed camera and viewport so
 * tests are deterministic.
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
  const [gestureActive, setGestureActive] = useState(false);

  useEffect(() => {
    onDocReady?.(doc);
  }, [doc, onDocReady]);

  const gesture = useTransformGesture({
    doc,
    camera,
    objects,
    canEdit,
    selection: sel,
    onGestureStart: () => {
      setGestureActive(true);
      onGestureStart?.();
    },
    onGestureEnd: () => {
      setGestureActive(false);
      onGestureEnd?.();
    },
  });

  useBoardKeys({ objects, selection: sel, doc, canEdit });

  const createAtScreen = useCallback(
    (p: Point) => {
      if (!canEdit) return;
      const w = screenToWorld(camera, p);
      const id = createSticky(doc, w);
      if (id) sel.startEdit(id);
    },
    [camera, doc, sel, canEdit],
  );

  const createAtCenter = useCallback(() => {
    createAtScreen({ x: viewportSize.width / 2, y: viewportSize.height / 2 });
  }, [createAtScreen, viewportSize.width, viewportSize.height]);

  const handleDeleteSelection = useCallback(() => {
    if (!canEdit) return;
    if (sel.ids.size === 0) return;
    deleteObjects(doc, [...sel.ids]);
    sel.clear();
  }, [doc, sel, canEdit]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!canEdit) return;
      if (sel.ids.size === 1) {
        const [id] = sel.ids;
        setStickyColor(doc, id, c);
      }
    },
    [doc, sel, canEdit],
  );

  const handleMarqueeSelect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, additive: boolean) => {
      sel.setMany(objectsInRect(objects, rect), additive);
    },
    [objects, sel],
  );

  // Stable render order (by id) so z-changes only affect z-index, never DOM order.
  const orderedObjects = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const selectedSticky =
    sel.ids.size === 1 && sel.editingId === null && !gestureActive
      ? objects.find((o) => o.id === [...sel.ids][0] && o.type === 'sticky')
      : undefined;

  let pos: { left: number; top: number } | null = null;
  if (selectedSticky) {
    const b = objectBounds(selectedSticky as ObjectSnapshot);
    const tl = worldToScreen(camera, { x: b.x, y: b.y });
    pos = { left: tl.x + (b.width * camera.zoom) / 2, top: tl.y - 8 };
  }

  return (
    <div>
      <BoardViewport
        camera={camera}
        beginPan={beginPan ?? (() => {})}
        panMove={panMove ?? (() => {})}
        endPan={endPan ?? (() => {})}
        wheel={wheel ?? (() => {})}
        onCreateStickyAt={createAtScreen}
        onClearSelection={() => sel.clear()}
        onMarqueeSelect={handleMarqueeSelect}
      >
        {orderedObjects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              selected={sel.ids.has(obj.id)}
              editing={sel.editingId === obj.id}
              onPointerDown={(e: PointerEvent) => gesture.onObjectPointerDown(e, obj.id)}
              onStartEdit={() => sel.startEdit(obj.id)}
              onEndEdit={(next) => (next === 'unselected' ? sel.clear() : sel.endEdit())}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        objects={objects}
        selectedIds={sel.ids}
        editingId={sel.editingId}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <Toolbar onCreateSticky={createAtCenter} disabled={!canEdit} />
      {selectedSticky && pos && (
        <div
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <NoteToolbar
            color={(selectedSticky as { color?: StickyColor }).color ?? 'yellow'}
            onColor={handleColor}
            onDelete={handleDeleteSelection}
          />
        </div>
      )}
      <SelectionBar count={sel.ids.size} onDeleteSelection={handleDeleteSelection} />
    </div>
  );
}
