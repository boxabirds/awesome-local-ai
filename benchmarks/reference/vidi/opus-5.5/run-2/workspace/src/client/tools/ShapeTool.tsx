/**
 * The Shape tool's input layer (anchors: shape.create_drag, shape.create_click,
 * shape.constrain, tools.return_to_select).
 *
 * A screen-space layer over the whole board while the tool is active: it owns every press,
 * so a drag that starts over an existing object never moves it. Dragging shows a dashed
 * preview of the kind (Shift, read on every move, makes it square / circular); release
 * creates the shape once with `createShape` (a click or a drag below the minimum size drops
 * a standard shape centred on the press), then closes the undo step and reports the id so
 * it is selected and Select becomes active. pointercancel creates nothing.
 */
import { useContext, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { UndoContext } from '../board/useUndo';
import { createShape, type ShapeKind } from '../../shared/objects/shape';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { layerPoint, PRIMARY_BUTTON } from './toolLayer';

const HALF = 2;

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  doc: Y.Doc;
  /** Identity stored as `createdBy`. */
  createdBy: string;
}

/** Screen rect from the press to the pointer; `square` grows both sides to the larger one from the press. */
export function dragRect(p0: Point, p1: Point, square: boolean): Rect {
  let dx = p1.x - p0.x;
  let dy = p1.y - p0.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  return { x: Math.min(p0.x, p0.x + dx), y: Math.min(p0.y, p0.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

function Preview(props: { kind: ShapeKind; rect: Rect }): React.JSX.Element {
  const { kind, rect: r } = props;
  const common = { className: 'shape-preview-outline', fill: 'none', strokeDasharray: '6 4' };
  return (
    <svg
      className="shape-preview"
      data-testid="shape-preview"
      data-kind={kind}
      style={{ left: `${r.x}px`, top: `${r.y}px` }}
      width={Math.max(r.width, 1)}
      height={Math.max(r.height, 1)}
      aria-hidden="true"
    >
      {kind === 'ellipse' ? (
        <ellipse cx={r.width / HALF} cy={r.height / HALF} rx={r.width / HALF} ry={r.height / HALF} {...common} />
      ) : kind === 'diamond' ? (
        <polygon
          points={`${r.width / HALF},0 ${r.width},${r.height / HALF} ${r.width / HALF},${r.height} 0,${r.height / HALF}`}
          {...common}
        />
      ) : (
        <rect x={0} y={0} width={r.width} height={r.height} {...common} />
      )}
    </svg>
  );
}

export function ShapeTool(props: ShapeToolProps): React.JSX.Element {
  const history = useContext(UndoContext);
  const press = useRef<{ pointerId: number; start: Point } | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== PRIMARY_BUTTON) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = { pointerId: e.pointerId, start: layerPoint(e) };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointerId) return;
    e.stopPropagation();
    const at = layerPoint(e);
    if (Math.hypot(at.x - p.start.x, at.y - p.start.y) < DRAG_THRESHOLD_PX) return;
    setPreview(dragRect(p.start, at, e.shiftKey));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointerId) return;
    e.stopPropagation();
    press.current = null;
    setPreview(null);
    const end = layerPoint(e);
    const { camera } = props;
    const moved = Math.hypot(end.x - p.start.x, end.y - p.start.y) >= DRAG_THRESHOLD_PX;
    const w0 = screenToWorld(camera, p.start);
    const w1 = screenToWorld(camera, end);
    const rect: Rect | null = moved
      ? { x: Math.min(w0.x, w1.x), y: Math.min(w0.y, w1.y), width: Math.abs(w1.x - w0.x), height: Math.abs(w1.y - w0.y) }
      : null;
    history.boundary();
    const id = createShape(props.doc, { kind: props.kind, rect, at: w0, square: e.shiftKey }, props.createdBy);
    history.boundary();
    if (id !== null) props.onCreated(id);
  };
  const onPointerCancel = () => {
    press.current = null;
    setPreview(null);
  };

  return (
    <div
      className="tool-layer shape-tool"
      data-testid="shape-tool"
      data-kind={props.kind}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview !== null && <Preview kind={props.kind} rect={preview} />}
    </div>
  );
}
