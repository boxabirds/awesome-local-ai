import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, type ShapeKind } from '../../shared/config';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { createShape } from '../../shared/objects/shape';
import { NO_UNDO, type UndoController } from '../board/undo';
import { localIdentityId } from '../identity';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { ToolLayer } from './ToolLayer';

/** The screen rectangle spanned by a drag; with Shift both sides become the larger one, growing away from the start. */
function dragRect(start: Point, cur: Point, square: boolean): Rect {
  if (!square) return normalizeRect(start, cur);
  const side = Math.max(Math.abs(cur.x - start.x), Math.abs(cur.y - start.y));
  const end = { x: start.x + (cur.x >= start.x ? side : -side), y: start.y + (cur.y >= start.y ? side : -side) };
  return normalizeRect(start, end);
}

interface Drag {
  pointerId: number;
  start: Point;
  cur: Point;
  shift: boolean;
}

/** Shape tool: drag to draw (dashed preview, Shift squares), click to drop a standard-size shape. */
export function ShapeTool(props: {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  undo?: UndoController;
  onCreated(id: string): void;
}) {
  const { kind, camera, doc, onCreated } = props;
  const undo = props.undo ?? NO_UNDO;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const set = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = { x: e.clientX, y: e.clientY };
    set({ pointerId: e.pointerId, start: p, cur: p, shift: e.shiftKey });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    set({ ...d, cur: { x: e.clientX, y: e.clientY }, shift: e.shiftKey });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    set(null);
    const cur = { x: e.clientX, y: e.clientY };
    const moved = Math.hypot(cur.x - d.start.x, cur.y - d.start.y) >= DRAG_THRESHOLD_PX;
    const square = e.shiftKey;
    let rect: Rect | null = null;
    if (moved) {
      const s = dragRect(d.start, cur, square);
      const tl = screenToWorld(camera, { x: s.x, y: s.y });
      const br = screenToWorld(camera, { x: s.x + s.width, y: s.y + s.height });
      rect = { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
    }
    undo.boundary();
    const id = createShape(doc, { kind, rect, at: screenToWorld(camera, d.start), square }, localIdentityId());
    undo.boundary();
    if (id) onCreated(id);
  };

  const preview = drag ? dragRect(drag.start, drag.cur, drag.shift) : null;
  return (
    <ToolLayer testId="shape-tool-layer" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => set(null)}>
      {preview && (
        <div
          data-testid="shape-preview"
          data-kind={kind}
          style={{
            position: 'fixed',
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
            border: '2px dashed #1e88e5',
            borderRadius: kind === 'ellipse' ? '50%' : 0,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}
    </ToolLayer>
  );
}
