import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { type Rect, normalizeRect } from '../../shared/geometry';
import { type ShapeKind, createShape } from '../../shared/objects/shape';
import type { UndoController } from '../board/undo';
import { type Camera, type Point, screenToWorld } from '../canvas/camera';

const PRIMARY_BUTTON = 0;

/**
 * The dragged rect in screen space. With `square` both sides become the larger
 * one, growing from `start` in the drag's direction.
 */
export function draggedRect(start: Point, current: Point, square: boolean): Rect {
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  }
  return normalizeRect(start, { x: start.x + dx, y: start.y + dy });
}

interface Drag {
  pointerId: number;
  start: Point;
  current: Point;
  shift: boolean;
}

/**
 * Shape tool (shape.ui): a screen-space layer over the board that owns every
 * press, so drags over existing objects never move them. A drag shows a dashed
 * preview (Shift squares it) and creates the shape on release; a click or a
 * drag smaller than SHAPE_MIN_SIZE_WORLD drops a standard-size shape centred on
 * the press. A cancelled pointer creates nothing.
 */
export function ShapeTool(props: {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  doc: Y.Doc;
  /** `createdBy` of new shapes. */
  createdBy: string;
  undo?: UndoController;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const local = (e: { clientX: number; clientY: number }): Point => {
    const rect = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || dragRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    const p = local(e);
    update({ pointerId: e.pointerId, start: p, current: p, shift: e.shiftKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    update({ ...d, current: local(e), shift: e.shiftKey });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    update(null);
    const { camera, kind, doc, undo } = props;
    const end = local(e);
    const at = screenToWorld(camera, d.start);
    let rect: Rect | null = null;
    if (Math.hypot(end.x - d.start.x, end.y - d.start.y) >= DRAG_THRESHOLD_PX) {
      const r = draggedRect(d.start, end, e.shiftKey);
      const tl = screenToWorld(camera, { x: r.x, y: r.y });
      rect = { x: tl.x, y: tl.y, width: r.width / camera.zoom, height: r.height / camera.zoom };
    }
    undo?.boundary();
    const id = createShape(doc, { kind, rect, at, square: e.shiftKey }, props.createdBy);
    undo?.boundary();
    // Rejected by the model: the tool stays active and nothing is created.
    if (id !== null) props.onCreated(id);
  };

  const cancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) update(null);
  };

  let preview: Rect | null = null;
  if (drag && Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) >= DRAG_THRESHOLD_PX) {
    preview = draggedRect(drag.start, drag.current, drag.shift);
  }
  const tooSmall =
    preview !== null &&
    (preview.width / props.camera.zoom < SHAPE_MIN_SIZE_WORLD || preview.height / props.camera.zoom < SHAPE_MIN_SIZE_WORLD);

  return (
    <div
      ref={ref}
      className="tool-layer shape-tool"
      data-testid="shape-tool"
      data-kind={props.kind}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <svg
          className="shape-preview"
          data-testid="shape-preview"
          data-too-small={tooSmall ? 'true' : 'false'}
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
          width={preview.width}
          height={preview.height}
          aria-hidden="true"
        >
          {props.kind === 'ellipse' ? (
            <ellipse cx={preview.width / 2} cy={preview.height / 2} rx={preview.width / 2} ry={preview.height / 2} />
          ) : props.kind === 'diamond' ? (
            <polygon
              points={`${preview.width / 2},0 ${preview.width},${preview.height / 2} ${preview.width / 2},${preview.height} 0,${preview.height / 2}`}
            />
          ) : (
            <rect x={0} y={0} width={preview.width} height={preview.height} />
          )}
        </svg>
      )}
    </div>
  );
}
