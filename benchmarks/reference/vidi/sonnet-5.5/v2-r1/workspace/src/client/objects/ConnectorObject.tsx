import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  HANDLE_SIZE_PX,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { objectAt, setConnectorEndpoint } from '../../shared/objects/connector';
import type { ConnectorSnap } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

const NO_RECTS: ReadonlyMap<string, Rect> = new Map();
const LINE_COLOR = '#263238';
const SELECTED_COLOR = '#2563eb';
const HANDLE_RADIUS_PX = HANDLE_SIZE_PX * 0.75;
const HALF = 2;

/** Polyline of an arrow's current ends (what the hit test measures against). */
export function connectorLine(c: ConnectorSnap): Point[] {
  return c.ends ? [c.ends.from, c.ends.to] : [];
}

/** True when `world` is within the click tolerance (6 screen px at `zoom`) of the arrow's line. */
export function hitsConnector(c: ConnectorSnap, world: Point, zoom: number): boolean {
  return distanceToPolyline(connectorLine(c), world) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

/** The arrowhead triangle with its tip at `to`, and the point where the shaft should stop. */
export function arrowhead(from: Point, to: Point, size: number): { points: string; base: Point } {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return { points: '', base: to };
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const head = Math.min(size, length);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const wing = head / HALF;
  const left = { x: base.x - uy * wing, y: base.y + ux * wing };
  const right = { x: base.x + uy * wing, y: base.y - ux * wing };
  return { points: `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`, base };
}

interface EndDrag {
  end: 'from' | 'to';
  point: Point;
}

export function ConnectorObject(props: ObjectProps) {
  const { doc, selected, zoom } = props;
  const connector = props.object as ConnectorSnap;
  const rects = props.rects ?? NO_RECTS;
  const undo = useUndoController();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<EndDrag | null>(null);
  const live = useRef({ connector, rects, zoom, undo });
  live.current = { connector, rects, zoom, undo };
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const origin = svg.current?.closest('[data-testid="board-world"]')?.getBoundingClientRect();
    const z = live.current.zoom;
    return { x: (e.clientX - (origin?.left ?? 0)) / z, y: (e.clientY - (origin?.top ?? 0)) / z };
  };

  if (!connector.ends) return <></>;
  const ends = connector.ends;
  const from = drag?.end === 'from' ? drag.point : ends.from;
  const to = drag?.end === 'to' ? drag.point : ends.to;
  const head = arrowhead(from, to, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  const color = selected ? SELECTED_COLOR : LINE_COLOR;

  const onLinePointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // Real pointers only reach this element inside the tolerance band; the check also covers synthetic events.
    if (!hitsConnector(connector, toWorld(e), zoom)) return;
    e.stopPropagation();
    if (!props.readOnly) props.onObjectPointerDown(e, connector.id);
  };

  const startEndDrag = (e: ReactPointerEvent, end: 'from' | 'to') => {
    e.stopPropagation();
    if (e.button !== 0 || props.readOnly || stop.current) return;
    const pointerId = e.pointerId;
    live.current.undo?.boundary();
    setDrag({ end, point: toWorld(e) });
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) setDrag({ end, point: toWorld(ev) });
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      setDrag(null);
      if (cancelled) return;
      const { connector: c, rects: r, undo: u } = live.current;
      const p = toWorld(ev);
      const target = objectAt(r, p);
      const opposite = c[end === 'from' ? 'to' : 'from'];
      // Over the object at the other end: rejected, the handle snaps back.
      if (target !== null && opposite.kind === 'attached' && opposite.objectId === target) return;
      setConnectorEndpoint(
        doc,
        c.id,
        end,
        target !== null ? { kind: 'attached', objectId: target, fallback: p } : { kind: 'free', x: p.x, y: p.y },
      );
      u?.boundary();
    };
    const onUp = (ev: PointerEvent) => finish(ev, false);
    const onCancel = (ev: PointerEvent) => finish(ev, true);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stop.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    stop.current = cleanup;
  };

  const handle = (end: 'from' | 'to', at: Point) => (
    <circle
      key={end}
      role="button"
      aria-label={end === 'from' ? 'Arrow start handle' : 'Arrow end handle'}
      data-end={end}
      cx={at.x}
      cy={at.y}
      r={HANDLE_RADIUS_PX / zoom}
      fill="#fff"
      stroke={SELECTED_COLOR}
      strokeWidth={2 / zoom}
      style={{ pointerEvents: 'all', cursor: 'grab' }}
      onPointerDown={(e) => startEndDrag(e, end)}
    />
  );

  return (
    <svg
      ref={svg}
      role="group"
      aria-label="Arrow"
      data-connector-object=""
      data-note-id={connector.id}
      data-selected={selected ? 'true' : 'false'}
      width={1}
      height={1}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: connector.z }}
    >
      <line
        data-testid="connector-hit"
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={(HALF * CONNECTOR_HIT_TOLERANCE_PX) / zoom}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={onLinePointerDown}
      />
      <line
        data-testid="connector-line"
        x1={from.x}
        y1={from.y}
        x2={head.base.x}
        y2={head.base.y}
        stroke={color}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        strokeLinecap="round"
      />
      {head.points && <polygon data-testid="connector-head" points={head.points} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />}
      {selected && !props.readOnly && (
        <>
          {handle('from', from)}
          {handle('to', to)}
        </>
      )}
    </svg>
  );
}
