// Shape tool (story 10): drag to draw a shape of the chosen kind, or click to drop a standard
// one. The tool owns every press on the board while active (it captures the pointer), so a drag
// that starts over an existing object never moves it.
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { type Point, normalizeRect } from '../../shared/geometry';
import { type ShapeKind, createShape, shapeRect } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { type Camera, screenToWorld, worldToScreen } from '../canvas/camera';

const PRIMARY_BUTTON = 0;

interface Sizing {
  pointerId: number;
  /** Press point, local screen px. */
  start: Point;
  current: Point;
  shift: boolean;
}

function localPoint(e: { clientX: number; clientY: number; currentTarget: Element }): Point {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function ShapeTool(props: {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  doc: Y.Doc;
  /** Identity stored as `createdBy`. */
  by: string;
}) {
  const { camera } = props;
  const history = useUndoController();
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const sizingRef = useRef<Sizing | null>(null);
  const update = (s: Sizing | null) => {
    sizingRef.current = s;
    setSizing(s);
  };

  /** The world rect the gesture would create now; null rect = click. */
  const worldArgs = (s: Sizing) => {
    const at = screenToWorld(camera, s.start);
    const dragged =
      Math.hypot(s.current.x - s.start.x, s.current.y - s.start.y) >= DRAG_THRESHOLD_PX;
    const rect = dragged ? normalizeRect(at, screenToWorld(camera, s.current)) : null;
    return { at, rect, square: s.shift };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON) return;
    // No focus change and no text selection from the press.
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = localPoint(e);
    update({ pointerId: e.pointerId, start: p, current: p, shift: e.shiftKey });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = sizingRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    update({ ...s, current: localPoint(e), shift: e.shiftKey });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = sizingRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    e.stopPropagation();
    update(null);
    const args = worldArgs({ ...s, current: localPoint(e), shift: e.shiftKey });
    history?.boundary();
    const id = createShape(props.doc, { kind: props.kind, ...args }, props.by);
    history?.boundary();
    // Rejected by the model: nothing created, the tool stays active.
    if (id) props.onCreated(id);
  };
  const onPointerCancel = () => update(null);

  // Preview: the rect that would be created (nothing for a click or a tiny drag).
  let preview = null;
  if (sizing) {
    const args = worldArgs(sizing);
    if (args.rect) {
      const r = shapeRect(args.rect, args.at, args.square);
      const tl = worldToScreen(camera, r);
      preview = (
        <div
          className={`shape-preview shape-preview-${props.kind}`}
          data-testid="shape-preview"
          style={{ left: tl.x, top: tl.y, width: r.width * camera.zoom, height: r.height * camera.zoom }}
        />
      );
    }
  }

  return (
    <div
      className="tool-layer shape-tool"
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
