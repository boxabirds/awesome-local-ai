import { useContext, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { createShape, type ShapeKind } from '../../shared/objects/shape';
import { screenToWorld, type Camera } from '../canvas/camera';
import { asStep, UndoContext } from '../board/useUndo';
import { ShapeOutline } from '../objects/ShapeObject';

interface Sizing {
  pointerId: number;
  /** Viewport px. */
  start: Point;
  current: Point;
  shift: boolean;
}

/** The dragged screen rect from `start` towards `current`; with `square` both sides are the larger one. */
export function dragRect(start: Point, current: Point, square: boolean): Rect {
  let end = current;
  if (square) {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    end = { x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side) };
  }
  return normalizeRect(start, end);
}

/**
 * The Shape tool's input surface over the whole board (shape.create_drag, shape.create_click, shape.constrain).
 * It takes every press on the board, objects included, so a drag that starts over an object never moves it. A
 * drag shows a dashed screen-space preview (Shift squares it, read on every move); the release creates the shape
 * in one undo step and hands its id to `onCreated`. A click or a tiny drag drops a standard-size shape centred on
 * the press; pointercancel creates nothing.
 */
export function ShapeTool(props: {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  doc: Y.Doc;
  /** Author recorded on the new shape. */
  by: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const undo = useContext(UndoContext);
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const sizingRef = useRef<Sizing | null>(null);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const update = (s: Sizing | null) => {
    sizingRef.current = s;
    setSizing(s);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || sizingRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic pointer: moves still arrive while over the surface.
    }
    const at = local(e);
    update({ pointerId: e.pointerId, start: at, current: at, shift: e.shiftKey });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = sizingRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    update({ ...s, current: local(e), shift: e.shiftKey });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = sizingRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    e.stopPropagation();
    update(null);
    const current = local(e);
    const square = e.shiftKey;
    const { camera } = props;
    const moved = Math.hypot(current.x - s.start.x, current.y - s.start.y) >= DRAG_THRESHOLD_PX;
    const screen = dragRect(s.start, current, square);
    const topLeft = screenToWorld(camera, { x: screen.x, y: screen.y });
    const rect = moved
      ? { x: topLeft.x, y: topLeft.y, width: screen.width / camera.zoom, height: screen.height / camera.zoom }
      : null;
    const at = screenToWorld(camera, s.start);
    const id = asStep(undo, () => createShape(props.doc, { kind: props.kind, rect, at, square }, props.by));
    if (id) props.onCreated(id);
  };
  const cancel = (e: ReactPointerEvent) => {
    if (sizingRef.current?.pointerId === e.pointerId) update(null);
  };

  const preview = sizing ? dragRect(sizing.start, sizing.current, sizing.shift) : null;

  return (
    <div
      ref={ref}
      className="tool-surface tool-surface--shape"
      data-testid="shape-tool"
      data-kind={props.kind}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <svg
          className="shape-preview"
          data-testid="shape-preview"
          style={{ left: preview.x, top: preview.y }}
          width={Math.max(1, preview.width)}
          height={Math.max(1, preview.height)}
          aria-hidden="true"
        >
          <g strokeDasharray="6 4">
            <ShapeOutline
              kind={props.kind}
              width={Math.max(1, preview.width)}
              height={Math.max(1, preview.height)}
              fill={SHAPE_FILL_COLORS.none}
              stroke={SHAPE_STROKE_COLORS.blue}
            />
          </g>
        </svg>
      )}
    </div>
  );
}
