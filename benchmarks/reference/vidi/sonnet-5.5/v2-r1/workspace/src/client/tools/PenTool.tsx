import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';

interface Drag {
  pointerId: number;
  points: Point[]; // world
  startClient: Point;
  moved: boolean;
  zoom: number; // zoom while drawing: the smoothing tolerance is in screen pixels at this zoom
  split: boolean; // a part has already been committed (a lone restart point is not a new dot)
}

/**
 * Full-board layer shown while the Pen tool is active. It owns the whole gesture (pointer captured), so dragging from
 * over an object never pans or moves it; the wheel still reaches the viewport. The preview is local only and is
 * written to the document as one stroke when the drag finishes (or is interrupted, or reaches the point limit).
 */
export function PenTool(props: { camera: Camera; color: PenColor; thickness: PenThickness; doc: Y.Doc; identityId: string }) {
  const { camera, color, thickness, doc, identityId } = props;
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [previewD, setPreviewD] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const undo = useUndoController();
  const live = useRef({ camera, color, thickness, doc, identityId, undo });
  live.current = { camera, color, thickness, doc, identityId, undo };

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(
    () => () => {
      drag.current = null;
      cancelFrame();
    },
    [],
  );

  const offset = (): Point => {
    const box = layer.current?.getBoundingClientRect();
    return { x: box?.left ?? 0, y: box?.top ?? 0 };
  };
  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const o = offset();
    return screenToWorld(live.current.camera, { x: e.clientX - o.x, y: e.clientY - o.y });
  };

  const renderPreview = () => {
    frame.current = null;
    const d = drag.current;
    if (!d) return;
    const cam = live.current.camera;
    setPreviewD(
      d.points
        .map((p, i) => {
          const s = worldToScreen(cam, p);
          return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
        })
        .join(' '),
    );
  };
  const schedulePreview = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(renderPreview);
  };

  const commit = (points: Point[], zoom: number) => {
    const { color: c, thickness: t, doc: dc, identityId: by, undo: u } = live.current;
    const result = points.length > 1 ? simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom) : points;
    u?.boundary();
    createStroke(dc, { points: result, color: c, thickness: t }, by);
    u?.boundary();
  };

  const finish = (e: { pointerId: number }) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    cancelFrame();
    setPreviewD(null);
    layer.current?.releasePointerCapture?.(e.pointerId);
    if (!d.moved) commit(d.points.slice(0, 1), d.zoom);
    else if (!(d.split && d.points.length < 2)) commit(d.points, d.zoom);
  };

  const append = (d: Drag, e: { clientX: number; clientY: number }) => {
    d.points.push(toWorld(e));
    if (!d.moved && Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) >= DRAG_THRESHOLD_PX) d.moved = true;
    if (d.points.length >= STROKE_MAX_POINTS) {
      commit(d.points, d.zoom);
      d.points = [d.points[d.points.length - 1]];
      d.split = true;
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    layer.current?.setPointerCapture?.(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      points: [toWorld(e)],
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
      zoom: live.current.camera.zoom,
      split: false,
    };
    schedulePreview();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = offset();
    setCursor({ x: e.clientX - o.x, y: e.clientY - o.y });
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const native = e.nativeEvent as PointerEvent | undefined;
    const coalesced = native?.getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [e];
    for (const ev of events) append(d, ev);
    schedulePreview();
  };

  return (
    <div
      ref={layer}
      className="tool-layer pen-tool-layer"
      data-testid="pen-tool-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => !drag.current && setCursor(null)}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {previewD && (
        <svg className="pen-preview-svg" aria-hidden="true">
          <path
            data-testid="pen-preview"
            d={previewD}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor && (
        <div
          className="pen-cursor"
          data-testid="pen-cursor"
          style={{
            left: cursor.x,
            top: cursor.y,
            width: PEN_THICKNESS_WORLD[thickness] * camera.zoom,
            height: PEN_THICKNESS_WORLD[thickness] * camera.zoom,
            background: PEN_COLORS[color],
          }}
        />
      )}
    </div>
  );
}
