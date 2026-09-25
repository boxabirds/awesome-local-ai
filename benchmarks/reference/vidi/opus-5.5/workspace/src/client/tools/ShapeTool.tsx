import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ShapeKind } from '../../shared/board-model';
import { SHAPE_STROKE_COLORS, DEFAULT_SHAPE_STROKE } from '../../shared/config';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { createShape, shapeRect } from '../../shared/objects/shape';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { ShapeOutline } from '../objects/ShapeObject';

const PRIMARY_BUTTON = 0;
/** Preview outline width in screen px. */
const PREVIEW_STROKE_PX = 1.5;

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  /** Recorded as `createdBy`. */
  createdBy: string;
  /** Selects the new shape and returns to Select (tools.return_to_select). */
  onCreated(id: string): void;
  /** Runs the creation as one undo step (story 8); default: run it as is. */
  step?<T>(action: () => T): T;
}

interface Press {
  pointerId: number;
  /** Board-area coordinates (screen px). */
  start: Point;
  current: Point;
  shift: boolean;
}

function localPoint(el: Element, e: { clientX: number; clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const run = <T,>(action: () => T): T => action();

/**
 * The Shape tool (story 10): a transparent layer over the whole board that owns every press
 * while the tool is active, so a drag that starts over an existing object never moves it. A
 * drag shows a dashed preview of the shape (Shift: square / circle); release creates it
 * (shape.create_drag); a click or a drag smaller than SHAPE_MIN_SIZE_WORLD drops a
 * default-size shape centred on the press (shape.create_click). pointercancel creates nothing.
 */
export function ShapeTool({ kind, camera, doc, createdBy, onCreated, step = run }: ShapeToolProps) {
  const [press, setPress] = useState<Press | null>(null);
  const pressRef = useRef<Press | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const update = (p: Press | null) => {
    pressRef.current = p;
    setPress(p);
  };

  /** The world rect the gesture would create (null: a click, default size at the press point). */
  const worldRect = (p: Press): { rect: Rect | null; at: Point; square: boolean } => {
    const cam = cameraRef.current;
    const at = screenToWorld(cam, p.start);
    const end = screenToWorld(cam, p.current);
    const moved = p.current.x !== p.start.x || p.current.y !== p.start.y;
    return { rect: moved ? normalizeRect(at, end) : null, at, square: p.shift };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || pressRef.current) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // The release still arrives without capture.
    }
    const p = localPoint(e.currentTarget, e);
    update({ pointerId: e.pointerId, start: p, current: p, shift: e.shiftKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pressRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    update({ ...p, current: localPoint(e.currentTarget, e), shift: e.shiftKey });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pressRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    e.stopPropagation();
    update(null);
    const final = { ...p, current: localPoint(e.currentTarget, e), shift: e.shiftKey };
    const { rect, at, square } = worldRect(final);
    const id = step(() => createShape(doc, { kind, rect, at, square }, createdBy));
    // Rejected by the model: nothing created, the tool stays active.
    if (id) onCreated(id);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pressRef.current?.pointerId === e.pointerId) update(null);
  };

  let preview = null;
  if (press) {
    const { rect, at, square } = worldRect(press);
    // Only once the drag is big enough to be a shape of its own (smaller ones drop a default shape).
    if (rect) {
      const r = shapeRect(rect, at, square);
      const tl = worldToScreen(camera, { x: r.x, y: r.y });
      const w = r.width * camera.zoom;
      const h = r.height * camera.zoom;
      const style: CSSProperties = { left: tl.x, top: tl.y, width: w, height: h };
      preview = (
        <svg
          className="shape-tool__preview"
          data-testid="shape-preview"
          data-kind={kind}
          style={style}
          width={w}
          height={h}
        >
          <ShapeOutline
            kind={kind}
            width={w}
            height={h}
            fill="none"
            stroke={SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE]}
            strokeWidth={PREVIEW_STROKE_PX}
            dashed
          />
        </svg>
      );
    }
  }

  return (
    <div
      className="tool-layer tool-layer--shape"
      data-testid="shape-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview}
    </div>
  );
}
