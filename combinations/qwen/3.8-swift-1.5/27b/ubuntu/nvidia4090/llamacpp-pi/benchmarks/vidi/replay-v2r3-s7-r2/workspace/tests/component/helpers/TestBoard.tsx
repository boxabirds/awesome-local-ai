import { useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { screenToWorld } from '../../../src/client/canvas/camera';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { getObjectType } from '../../../src/client/objects/registry';
import { createSticky, deleteObjects, setStickyColor } from '../../../src/shared/board-model';
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
  /** Gate for mutating operations (default true). */
  canEdit?: boolean;
  /** Gesture lifecycle spies (once per drag). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

/**
 * A test harness that mirrors the real Board: real Y.Doc, multi-selection,
 * registry-rendered objects, marquee, transform gesture, selection overlay/bar
 * and the board keyboard handlers — but with a fixed camera and viewport so
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
  const { doc, notes } = useBoardDoc();
  const sel = useSelection(notes);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection: sel,
    snapshot: notes,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });
  const marquee = useMarquee(camera, notes, (ids) => sel.setMany(ids, true));
  useBoardKeys({ doc, selection: sel, snapshot: notes, canEdit });

  useEffect(() => {
    onDocReady?.(doc);
  }, [doc, onDocReady]);

  const createAtScreen = useCallback(
    (p: Point) => {
      const w = screenToWorld(camera, p);
      const id = createSticky(doc, w);
      if (id) sel.startEdit(id);
    },
    [camera, doc, sel],
  );

  const createAtCenter = useCallback(() => {
    createAtScreen({ x: viewportSize.width / 2, y: viewportSize.height / 2 });
  }, [createAtScreen, viewportSize.width, viewportSize.height]);

  const handleDelete = useCallback(() => {
    if (!canEdit) return;
    const ids = [...sel.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    sel.clear();
  }, [doc, sel, canEdit]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      if (!canEdit) return;
      const ids = [...sel.ids];
      if (ids.length === 1) setStickyColor(doc, ids[0], c);
    },
    [doc, sel, canEdit],
  );

  // Stable render order (by id) so z-changes only affect z-index, never DOM order.
  const ordered = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
        marquee={marquee}
      >
        {ordered.map((obj) => {
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
              onPointerDown={gesture.onObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
            />
          );
        })}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={sel.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={sel.ids}
        snapshot={notes}
        camera={camera}
        editingId={sel.editingId}
        onDelete={handleDelete}
        onColor={handleColor}
      />
      <Toolbar onCreateSticky={createAtCenter} />
    </div>
  );
}
