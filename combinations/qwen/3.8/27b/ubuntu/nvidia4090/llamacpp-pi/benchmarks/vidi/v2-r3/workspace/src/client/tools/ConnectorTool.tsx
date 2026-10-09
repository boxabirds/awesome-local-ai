import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import { createConnector } from '../../shared/objects/connector';
import { findObjectAt } from '../objects/registry';
import type { UndoController } from '../board/undo';

/**
 * Story 10 (connectors): the Connector tool's screen-space layer.
 *
 * Hovering shows four dots at the side midpoints of the object under the
 * pointer (any registered type except connectors). Pressing starts a
 * preview line from the drag object's nearest-side anchor; the target's
 * nearest-side dot highlights as the pointer crosses sides; on release the
 * connector is created (attached to the drag target and, when over one, the
 * release target — otherwise its end is free at the release point). Releasing
 * over the start object creates nothing. The tool returns to Select after a
 * creation; Escape unmounts the layer (nothing is created).
 */
export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  undo: UndoController;
  by: string;
  onCreated(id: string): void;
}): ReactElement {
  const { camera, snapshot, rects, doc, undo, by, onCreated } = props;
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startWorld: Point;
    startId: string | null;
    pointerWorld: Point;
  } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  // Re-render counter while dragging (the pointer position itself lives in
  // dragRef; a same-value state would not trigger a render).
  const [, setTick] = useState(0);

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const toWorld = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(camera, toLocal(e));

  const hoverObj =
    !dragRef.current && hover ? findObjectAt(snapshot, hover, camera.zoom, rects, ['connector']) : null;
  const dragTarget = dragRef.current
    ? findObjectAt(snapshot, dragRef.current.pointerWorld, camera.zoom, rects, ['connector'])
    : null;

  // Preview line anchors (world).
  let startAnchor: Point | null = null;
  let endAnchor: Point | null = null;
  const dragState = dragRef.current;
  if (dragState) {
    const startRect = dragState.startId ? rects.get(dragState.startId) : undefined;
    startAnchor =
      startRect && dragTarget
        ? sideAnchor(startRect, nearestSide(startRect, center(dragTarget)))
        : dragState.startWorld;
    const targetRect = dragTarget ? rects.get(dragTarget.id) : undefined;
    endAnchor = targetRect
      ? sideAnchor(targetRect, nearestSide(targetRect, startAnchor))
      : dragState.pointerWorld;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = layerRef.current;
    if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    const w = toWorld(e);
    const hit = findObjectAt(snapshot, w, camera.zoom, rects, ['connector']);
    dragRef.current = { pointerId: e.pointerId, startWorld: w, startId: hit?.id ?? null, pointerWorld: w };
    setTick((t) => t + 1);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    if (dragRef.current) {
      dragRef.current.pointerWorld = w;
      setTick((t) => t + 1); // re-render to track the pointer
    } else {
      setHover(w);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setHover(null);
    const w = toWorld(e);
    const target = findObjectAt(snapshot, w, camera.zoom, rects, ['connector']);
    if (d.startId && target && target.id === d.startId) return; // same object: nothing
    const startRect = d.startId ? rects.get(d.startId) : undefined;
    const targetRect = target ? rects.get(target.id) : undefined;
    const fromAnchor =
      startRect && target ? sideAnchor(startRect, nearestSide(startRect, center(target))) : d.startWorld;
    const toAnchor = targetRect
      ? sideAnchor(targetRect, nearestSide(targetRect, fromAnchor))
      : w;
    // One undo step for the creation (story 8).
    undo.boundary();
    const id = createConnector(
      doc,
      d.startId ? { kind: 'attached', objectId: d.startId, fallback: fromAnchor } : { kind: 'free', x: d.startWorld.x, y: d.startWorld.y },
      target ? { kind: 'attached', objectId: target.id, fallback: toAnchor } : { kind: 'free', x: w.x, y: w.y },
      by,
    );
    if (id !== null) {
      undo.boundary();
      onCreated(id);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (dragRef.current && e.pointerId === dragRef.current.pointerId) {
      dragRef.current = null;
      setHover(null); // nothing is created
    }
  };

  // Screen-space rendering of the preview line, arrowhead and dots.
  const pvFrom = startAnchor ? worldToScreen(camera, startAnchor) : null;
  const pvTo = endAnchor ? worldToScreen(camera, endAnchor) : null;
  let arrow = '';
  if (pvFrom && pvTo) {
    const a = Math.atan2(pvTo.y - pvFrom.y, pvTo.x - pvFrom.x);
    const L = CONNECTOR_ARROWHEAD_SIZE_WORLD * camera.zoom;
    const p2 = { x: pvTo.x - L * Math.cos(a - Math.PI / 7), y: pvTo.y - L * Math.sin(a - Math.PI / 7) };
    const p3 = { x: pvTo.x - L * Math.cos(a + Math.PI / 7), y: pvTo.y - L * Math.sin(a + Math.PI / 7) };
    arrow = `${pvTo.x},${pvTo.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
  }

  const dotCircles: ReactElement[] = [];
  const dotObjs = dragRef.current
    ? dragTarget
      ? [dragTarget]
      : []
    : hoverObj
      ? [hoverObj]
      : [];
  for (const o of dotObjs) {
    const r = rects.get(o.id);
    if (!r) continue;
    const aim = dragRef.current
      ? (startAnchor ?? dragRef.current.pointerWorld)
      : center(o);
    const hi = dragRef.current ? nearestSide(r, aim) : null;
    for (const s of ['top', 'right', 'bottom', 'left'] as const) {
      const wp = sideAnchor(r, s);
      const sp = worldToScreen(camera, wp);
      const highlighted = hi === s;
      const radius = highlighted ? CONNECTOR_DOT_RADIUS_PX * 1.5 : CONNECTOR_DOT_RADIUS_PX;
      dotCircles.push(
        <circle
          key={`${o.id}-${s}`}
          data-connector-dot={s}
          data-connector-dot-object={o.id}
          {...(highlighted ? { 'data-connector-dot-highlight': 'true' } : {})}
          cx={sp.x}
          cy={sp.y}
          r={radius}
          fill="#fff"
          stroke="#1a73e8"
          strokeWidth={highlighted ? 3 : 2}
        />,
      );
    }
  }

  return (
    <div
      ref={layerRef}
      data-connector-tool-layer="true"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 15,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (!dragRef.current) setHover(null);
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {pvFrom && pvTo && (
          <line
            data-connector-preview="true"
            x1={pvFrom.x}
            y1={pvFrom.y}
            x2={pvTo.x}
            y2={pvTo.y}
            stroke="#1a73e8"
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * camera.zoom}
            strokeDasharray="6 4"
          />
        )}
        {arrow && <polygon points={arrow} fill="#1a73e8" />}
        {dotCircles}
      </svg>
    </div>
  );
}

function center(o: ObjectSnapshot): Point {
  return { x: o.x + (o.width ?? 0) / 2, y: o.y + (o.height ?? 0) / 2 };
}
