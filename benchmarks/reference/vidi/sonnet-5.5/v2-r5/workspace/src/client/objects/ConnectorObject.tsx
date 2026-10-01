import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_STROKE_WIDTH_WORLD, HANDLE_SIZE_PX,
} from '../../shared/config';
import { nearestSide, resolveEndpoints, sideAnchor, centreOf, type ConnectorSnap } from '../../shared/geometry/connector-geometry';
import type { Point, Rect } from '../../shared/geometry';
import { setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import { topRectAt } from '../tools/hit';
import type { ObjectProps } from './registry';

const PRIMARY_BUTTON = 0;
const HALF = 2;
const SELECTED_LIFT = 100_000; // a selected arrow stays above shapes so its end handles can be grabbed
const NO_RECTS: ReadonlyMap<string, Rect> = new Map();
const COLOR = '#37474f';
const SELECT_COLOR = '#2563eb';

type End = 'from' | 'to';

function arrowhead(from: Point, to: Point, size: number): string | null {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 1) return null;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const hw = size / HALF;
  return `${to.x},${to.y} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`;
}

/** Where an end released at `at` over `target` attaches: the target's side nearest the opposite end. */
export function endpointFor(
  rects: ReadonlyMap<string, Rect>, target: string | undefined, at: Point, toward: Point,
): Endpoint {
  const r = target ? rects.get(target) : undefined;
  if (!target || !r) return { kind: 'free', x: at.x, y: at.y };
  return { kind: 'attached', objectId: target, fallback: sideAnchor(r, nearestSide(r, toward)) };
}

export function ConnectorObject(props: ObjectProps) {
  const { doc, zoom, selected, dragging, readOnly, undo } = props;
  const c = props.object as ConnectorSnap;
  const rects = props.rects ?? NO_RECTS;
  const anchor = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ end: End; at: Point } | null>(null);

  const resolved = resolveEndpoints(c, rects);
  const from = drag?.end === 'from' ? drag.at : resolved.from;
  const to = drag?.end === 'to' ? drag.at : resolved.to;
  const head = arrowhead(from, to, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  const color = selected ? SELECT_COLOR : COLOR;

  /** The anchor svg is 1 x 1 world unit at the world origin, so its screen box maps client to world coordinates. */
  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const r = anchor.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0)) / zoom, y: (e.clientY - (r?.top ?? 0)) / zoom };
  };

  const handleDown = (end: End) => (e: ReactPointerEvent<SVGCircleElement>) => {
    if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON || readOnly) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ end, at: toWorld(e) });
  };
  const handleMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (drag) setDrag({ end: drag.end, at: toWorld(e) });
  };
  const handleUp = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag) return;
    const end = drag.end;
    const at = toWorld(e);
    setDrag(null);
    const other = end === 'from' ? c.to : c.from;
    const target = topRectAt(rects, at);
    // Released over the object at the other end: rejected, the handle snaps back.
    if (target && other.kind === 'attached' && other.objectId === target) return;
    const toward = other.kind === 'free' ? { x: other.x, y: other.y }
      : rects.has(other.objectId) ? centreOf(rects.get(other.objectId)!) : other.fallback;
    undo?.boundary();
    setConnectorEndpoint(doc, c.id, end, endpointFor(rects, target, at, toward));
    undo?.boundary();
  };
  const handleCancel = () => setDrag(null);

  const handleRadius = HANDLE_SIZE_PX / HALF / zoom;
  const handle = (end: End, p: Point, label: string) => (
    <circle
      key={end}
      role="button"
      aria-label={label}
      data-handle={end}
      cx={p.x}
      cy={p.y}
      r={handleRadius}
      fill="#fff"
      stroke={SELECT_COLOR}
      strokeWidth={1 / zoom}
      style={{ pointerEvents: 'all', cursor: 'grab', touchAction: 'none' }}
      onPointerDown={handleDown(end)}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
    />
  );

  return (
    <svg
      ref={anchor}
      width={1}
      height={1}
      className="connector-object"
      role="group"
      aria-label="Arrow"
      data-connector=""
      data-id={c.id}
      data-selected={selected}
      data-dragging={dragging}
      data-from-x={from.x}
      data-from-y={from.y}
      data-to-x={to.x}
      data-to-y={to.y}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: c.z + (selected ? SELECTED_LIFT : 0) }}
    >
      <line
        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
        stroke={color} strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD} strokeLinecap="round"
      />
      {head && <polygon points={head} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />}
      <line
        data-testid="connector-hit"
        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
        stroke="transparent"
        strokeWidth={(HALF * CONNECTOR_HIT_TOLERANCE_PX) / zoom}
        strokeLinecap="butt"
        style={{ pointerEvents: 'stroke', cursor: dragging ? 'grabbing' : 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
          e.stopPropagation();
          props.onPointerDown(e, c.id);
        }}
      />
      {selected && !readOnly && (
        <>
          {handle('from', from, 'Arrow start handle')}
          {handle('to', to, 'Arrow end handle')}
        </>
      )}
    </svg>
  );
}
