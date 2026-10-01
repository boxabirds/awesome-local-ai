import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ConnectorSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_HANDLE_RADIUS_PX, CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

const PRIMARY_BUTTON = 0;
const HEAD_HALF_WIDTH = 0.5;
const HEAD_SETBACK = 0.8;
const NO_RECTS: ReadonlyMap<string, Rect> = new Map();
const COLOR = '#263238';
const SELECTED_COLOR = '#1a73e8';

/** The topmost object under `p` (rects are in stacking order); arrows are not attach targets. */
export function objectAt(rects: ReadonlyMap<string, Rect>, p: Point): string | null {
  let hit: string | null = null;
  for (const [id, r] of rects) {
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) hit = id;
  }
  return hit;
}

export function ConnectorObject(props: ObjectProps) {
  const c = props.object as ConnectorSnapshot;
  const { doc, selected, zoom, readOnly } = props;
  const rects = props.rects ?? NO_RECTS;
  const undo = useUndoController();
  const [drag, setDrag] = useState<{ end: 'from' | 'to'; point: Point } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const latest = useRef({ c, rects, zoom, doc, undo });
  latest.current = { c, rects, zoom, doc, undo };

  const shown = drag ? { ...c, [drag.end]: { kind: 'free', x: drag.point.x, y: drag.point.y } } : c;
  const { from, to } = resolveEndpoints(shown, rects);

  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = len === 0 ? 1 : (to.x - from.x) / len;
  const uy = len === 0 ? 0 : (to.y - from.y) / len;
  const head = Math.min(CONNECTOR_ARROWHEAD_SIZE_WORLD, len);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const headPoints = [
    to,
    { x: base.x - uy * head * HEAD_HALF_WIDTH, y: base.y + ux * head * HEAD_HALF_WIDTH },
    { x: base.x + uy * head * HEAD_HALF_WIDTH, y: base.y - ux * head * HEAD_HALF_WIDTH },
  ].map((p) => `${p.x},${p.y}`).join(' ');
  const lineEnd = { x: to.x - ux * head * HEAD_SETBACK, y: to.y - uy * head * HEAD_SETBACK };
  const color = selected ? SELECTED_COLOR : COLOR;

  const onHandleDown = (e: ReactPointerEvent, end: 'from' | 'to') => {
    if (e.button !== PRIMARY_BUTTON || readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    cleanup.current?.();
    const startPoint = end === 'from' ? from : to;
    const sx = e.clientX;
    const sy = e.clientY;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    latest.current.undo?.boundary();
    const pointAt = (ev: PointerEvent): Point => ({
      x: startPoint.x + (ev.clientX - sx) / latest.current.zoom, y: startPoint.y + (ev.clientY - sy) / latest.current.zoom,
    });
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cleanup.current = null;
    };
    const onMove = (ev: PointerEvent) => setDrag({ end, point: pointAt(ev) });
    const onCancel = () => {
      detach();
      setDrag(null);
    };
    const onUp = (ev: PointerEvent) => {
      detach();
      setDrag(null);
      const { c: cur, rects: rs, doc: d, undo: u } = latest.current;
      const p = pointAt(ev);
      if (Math.hypot(p.x - startPoint.x, p.y - startPoint.y) * latest.current.zoom < 1) return; // a click on the handle
      const target = objectAt(rs, p);
      const r = target ? rs.get(target) : undefined;
      if (target && r) {
        setConnectorEndpoint(d, cur.id, end, { kind: 'attached', objectId: target, fallback: { x: p.x, y: p.y } });
      } else {
        setConnectorEndpoint(d, cur.id, end, { kind: 'free', x: p.x, y: p.y });
      }
      u?.boundary();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cleanup.current = detach;
  };

  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom;
  const handleR = CONNECTOR_HANDLE_RADIUS_PX / zoom;

  return (
    <div
      className="connector-object"
      data-connector=""
      data-object-id={c.id}
      data-note-id={c.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Arrow"
      style={{ zIndex: c.z }}
    >
      <svg className="connector-svg" width="1" height="1" aria-hidden="true">
        <line
          data-testid="connector-hit"
          x1={from.x} y1={from.y} x2={to.x} y2={to.y}
          stroke="transparent" strokeWidth={hitWidth} strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
          onPointerDown={(e) => props.onObjectPointerDown(e, c.id)}
        />
        <line
          data-testid="connector-line"
          x1={from.x} y1={from.y} x2={lineEnd.x} y2={lineEnd.y}
          stroke={color} strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD} strokeLinecap="round" pointerEvents="none"
        />
        <polygon data-testid="connector-head" points={headPoints} fill={color} pointerEvents="none" />
        {selected && !readOnly && (['from', 'to'] as const).map((end) => {
          const p = end === 'from' ? from : to;
          return (
            <circle
              key={end}
              data-testid={`connector-handle-${end}`}
              data-end={end}
              role="button"
              aria-label={end === 'from' ? 'Arrow start handle' : 'Arrow end handle'}
              cx={p.x} cy={p.y} r={handleR}
              fill="#fff" stroke={SELECTED_COLOR} strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'move', touchAction: 'none' }}
              onPointerDown={(e) => onHandleDown(e, end)}
            />
          );
        })}
      </svg>
    </div>
  );
}
