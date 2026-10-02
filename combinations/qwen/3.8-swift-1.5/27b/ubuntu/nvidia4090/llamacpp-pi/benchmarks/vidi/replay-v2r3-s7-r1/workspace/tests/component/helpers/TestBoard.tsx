import { useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { getObjectType } from '../../../src/client/objects/registry';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  objectsInRect,
  setStickyColor,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { unionRects } from '../../../src/shared/geometry';
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
  /** Gate creation/deletion/nudge/resize (mirrors the server-side canEdit). */
  canEdit?: boolean;
  /** Spies for the transform gesture (TC-26). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

/**
 * A test harness that mirrors the Board: real Y.Doc, multi-selection, the
 * transform gesture, marquee, board keys, selection overlay/bar — but with a
 * fixed camera and viewport so tests are deterministic.
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

  const gesture = useTransformGesture({
    doc,
    camera,
    objects,
    selectedIds: sel.ids,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });

  const onObjectPointerDown = useCallback(
    (e: PointerEvent, id: string) => {
      if (e.button !== 0) return;
      if (e.shiftKey) {
        // Shift-click: the gesture moves the selection AFTER the toggle.
        const next = new Set(sel.ids);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        sel.toggle(id);
        gesture.onObjectPointerDown(e, [...next]);
      } else if (sel.has(id)) {
        // Dragging an already-selected object moves the whole selection.
        gesture.onObjectPointerDown(e, [...sel.ids]);
      } else {
        // Plain click on an unselected object: it becomes the selection.
        sel.click(id);
        gesture.onObjectPointerDown(e, [id]);
      }
    },
    [sel, gesture],
  );

  const marquee = useMarquee(camera, (rect, additive) => {
    sel.setMany(objectsInRect(objects, rect), additive);
  });

  useBoardKeys({ doc, objects, selection: sel, canEdit });

  const handleDelete = useCallback(() => {
    if (!canEdit || sel.size === 0) return;
    deleteObjects(doc, [...sel.ids]);
  }, [doc, sel, canEdit]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!canEdit) return;
      for (const id of sel.ids) {
        const o = objects.find((x) => x.id === id);
        if (o?.type === 'sticky') setStickyColor(doc, id, c);
      }
    },
    [doc, sel, objects, canEdit],
  );

  const selectedObjects = objects.filter((o) => sel.has(o.id));
  const box = unionRects(selectedObjects.map(objectBounds));
  const showsHandles =
    selectedObjects.length > 0 &&
    selectedObjects.every((o) => getObjectType(o.type)?.resizable !== false);
  const showOverlay = sel.size > 0 && sel.editingId === null;
  const showBar = sel.size > 0 && sel.editingId === null && !gesture.active;

  // Stable render order (by id) so z-changes only affect z-index, never DOM order.
  const orderedObjects = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let pos: { left: number; top: number } | null = null;
  if (box && showBar) {
    const topCenter = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });
    pos = { left: topCenter.x, top: topCenter.y - 8 };
  }

  const singleSticky =
    sel.size === 1
      ? (objects.find((o) => sel.has(o.id)) as StickySnapshot | undefined) ?? null
      : null;

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
        onMarqueeStart={(e) => {
          marquee.begin(e);
          return true;
        }}
      >
        {orderedObjects.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={o.id}
              obj={o}
              doc={doc}
              zoom={camera.zoom}
              selected={sel.has(o.id)}
              editing={o.id === sel.editingId}
              onPointerDown={onObjectPointerDown}
              onStartEdit={(id) => sel.startEdit(id)}
              onEndEdit={(next) => {
                sel.endEdit();
                if (next === 'unselected') sel.clear();
              }}
            />
          );
        })}
        {marquee.rect && <MarqueeRect rect={marquee.rect} />}
        {box && showOverlay && (
          <SelectionOverlay
            box={box}
            zoom={camera.zoom}
            showHandles={showsHandles}
            canEdit={canEdit}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        )}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCenter} disabled={!canEdit} />
      {showBar && pos && (
        <div
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <SelectionBar
            count={sel.size}
            sticky={singleSticky && singleSticky.type === 'sticky' ? singleSticky : null}
            onColor={handleColor}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}
