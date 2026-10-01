import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import type { ShapeKind } from '../../shared/config';
import { normalizeRect } from '../../shared/geometry';
import type { Point, Rect } from '../../shared/geometry';
import { createShape } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { getLocalUserId } from '../identity';

interface Drag {
  pointerId: number;
  start: Point; // world
  startClient: Point;
  current: Point; // world
  moved: boolean;
  shift: boolean;
}

/** The world rect a drag covers; with Shift both sides are the larger dimension, anchored at the drag origin. */
export function dragRect(start: Point, end: Point, shift: boolean): Rect {
  const r = normalizeRect(start, end);
  if (!shift) return r;
  const side = Math.max(r.width, r.height);
  return { x: end.x >= start.x ? start.x : start.x - side, y: end.y >= start.y ? start.y : start.y - side, width: side, height: side };
}

/**
 * Full-board layer shown while the Shape tool is active. It owns the whole gesture (pointer captured), so dragging
 * from over an existing object never moves that object. Escape is handled by the board (it switches to Select).
 */
export function ShapeTool(props: { kind: ShapeKind; camera: Camera; doc: Y.Doc; onCreated(id: string): void }) {
  const { kind, camera, doc, onCreated } = props;
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const undo = useUndoController();

  // A drag is abandoned when the tool goes away (Escape) or the pointer is lost.
  useEffect(() => () => void (drag.current = null), []);

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const box = layer.current?.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) });
  };

  const updatePreview = (d: Drag) => {
    const r = dragRect(d.start, d.current, d.shift);
    const p = worldToScreen(camera, r);
    setPreview({ x: p.x, y: p.y, width: r.width * camera.zoom, height: r.height * camera.zoom });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    layer.current?.setPointerCapture?.(e.pointerId);
    const p = toWorld(e);
    drag.current = { pointerId: e.pointerId, start: p, startClient: { x: e.clientX, y: e.clientY }, current: p, moved: false, shift: e.shiftKey };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.current = toWorld(e);
    d.shift = e.shiftKey;
    if (!d.moved && Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) >= DRAG_THRESHOLD_PX) d.moved = true;
    if (d.moved) updatePreview(d);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setPreview(null);
    layer.current?.releasePointerCapture?.(e.pointerId);
    if (cancelled) return;
    d.current = toWorld(e);
    d.shift = e.shiftKey;
    const moved = d.moved || Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) >= DRAG_THRESHOLD_PX;
    undo?.boundary();
    const id = createShape(
      doc,
      { kind, rect: moved ? dragRect(d.start, d.current, d.shift) : null, at: d.start, square: moved && d.shift },
      getLocalUserId(),
    );
    undo?.boundary();
    if (id) onCreated(id);
  };

  return (
    <div
      ref={layer}
      className="tool-layer shape-tool-layer"
      data-testid="shape-tool-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <div
          className={`shape-preview shape-preview--${kind}`}
          data-testid="shape-preview"
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
        />
      )}
    </div>
  );
}
