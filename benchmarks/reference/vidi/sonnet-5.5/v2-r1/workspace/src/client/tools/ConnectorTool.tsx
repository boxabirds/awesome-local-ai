import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import { SIDES, nearestSide, rectCentre, sideAnchor } from '../../shared/geometry/connector-geometry';
import type { Side } from '../../shared/geometry/connector-geometry';
import type { Point, Rect } from '../../shared/geometry';
import { connectableRects, createConnector, objectAt } from '../../shared/objects/connector';
import type { Endpoint } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { getLocalUserId } from '../identity';

interface Drag {
  pointerId: number;
  start: Point;
  startId: string | null;
}

const HIGHLIGHT_SCALE = 1.8;

/**
 * Full-board layer shown while the Connector tool is active: side dots on the object under the pointer, a preview
 * while dragging, and the arrow on release. `snapshot` is in stacking order.
 */
export function ConnectorTool(props: { camera: Camera; snapshot: readonly ObjectSnapshot[]; doc: Y.Doc; onCreated(id: string): void }) {
  const { camera, snapshot, doc, onCreated } = props;
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const undo = useUndoController();
  const rects = useMemo(() => connectableRects(snapshot), [snapshot]);
  const [hover, setHover] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const box = layer.current?.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) });
  };
  const toScreen = (p: Point): Point => worldToScreen(camera, p);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    layer.current?.setPointerCapture?.(e.pointerId);
    const start = toWorld(e);
    drag.current = { pointerId: e.pointerId, start, startId: objectAt(rects, start) };
    setDragging(drag.current);
    setPointer(start);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = toWorld(e);
    setPointer(p);
    if (!drag.current) setHover(objectAt(rects, p));
  };

  const end = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setDragging(null);
    layer.current?.releasePointerCapture?.(e.pointerId);
    if (cancelled) return;
    const p = toWorld(e);
    const endId = objectAt(rects, p);
    if (endId !== null && endId === d.startId) return;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const from: Endpoint = d.startId ? { kind: 'attached', objectId: d.startId, fallback: d.start } : { kind: 'free', x: d.start.x, y: d.start.y };
    const to: Endpoint = endId ? { kind: 'attached', objectId: endId, fallback: p } : { kind: 'free', x: p.x, y: p.y };
    undo?.boundary();
    const id = createConnector(doc, from, to, getLocalUserId());
    undo?.boundary();
    if (id) onCreated(id);
  };

  // While dragging, the target under the pointer; otherwise the hovered object.
  const target = dragging ? (pointer ? objectAt(rects, pointer) : null) : hover;
  const targetRect: Rect | undefined = target !== null && target !== dragging?.startId ? rects.get(target) : undefined;
  const startRect = dragging?.startId ? rects.get(dragging.startId) : undefined;
  const startPoint = dragging ? (startRect ? rectCentre(startRect) : dragging.start) : null;
  const highlight: Side | null = dragging && targetRect && startPoint ? nearestSide(targetRect, startPoint) : null;
  const dotRect = dragging ? targetRect : target !== null ? rects.get(target) : undefined;

  let line: { a: Point; b: Point } | null = null;
  if (dragging && pointer && startPoint) {
    const aim = targetRect ? sideAnchor(targetRect, nearestSide(targetRect, startPoint)) : pointer;
    const a = startRect ? sideAnchor(startRect, nearestSide(startRect, aim)) : dragging.start;
    line = { a: toScreen(a), b: toScreen(aim) };
  }

  return (
    <div
      ref={layer}
      className="tool-layer connector-tool-layer"
      data-testid="connector-tool-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => !drag.current && setHover(null)}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="connector-tool-svg" width="100%" height="100%">
        {line && (
          <line
            data-testid="connector-preview"
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {dotRect &&
          SIDES.map((side) => {
            const p = toScreen(sideAnchor(dotRect, side));
            const on = highlight === side;
            return (
              <circle
                key={side}
                data-testid="connector-dot"
                data-side={side}
                data-highlighted={on ? 'true' : 'false'}
                cx={p.x}
                cy={p.y}
                r={on ? CONNECTOR_DOT_RADIUS_PX * HIGHLIGHT_SCALE : CONNECTOR_DOT_RADIUS_PX}
                fill={on ? '#2563eb' : '#fff'}
                stroke="#2563eb"
                strokeWidth={1.5}
              />
            );
          })}
      </svg>
    </div>
  );
}
