import { useContext, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  HANDLE_SIZE_PX,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint, type ConnectorSnap } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { ObjectRectsContext } from './rectsContext';

const HANDLE_COLOR = '#1e88e5';

/** Topmost rectangle containing the point; `rects` is in z order. */
function rectIdAt(rects: ReadonlyMap<string, Rect>, p: Point): string | undefined {
  let found: string | undefined;
  rects.forEach((r, id) => {
    if (p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height) found = id;
  });
  return found;
}

interface EndDrag {
  end: 'from' | 'to';
  pointerId: number;
  startClient: Point;
  startPoint: Point;
  cur: Point;
}

export function ConnectorObject(props: ObjectProps & { rects?: ReadonlyMap<string, Rect> }) {
  const { doc, selected, editable, zoom } = props;
  const connector = props.object as ConnectorSnap;
  const ctxRects = useContext(ObjectRectsContext);
  const rects = props.rects ?? ctxRects;
  const undo = useUndoController();
  const [drag, setDrag] = useState<EndDrag | null>(null);
  const dragRef = useRef<EndDrag | null>(null);
  const set = (d: EndDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const ends = resolveEndpoints(connector, rects);
  const from = drag?.end === 'from' ? drag.cur : ends.from;
  const to = drag?.end === 'to' ? drag.cur : ends.to;

  // The line stops at the arrowhead's base so the stroke does not poke through the tip.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 0;
  const uy = len > 0 ? dy / len : 0;
  const head = Math.min(CONNECTOR_ARROWHEAD_SIZE_WORLD, len);
  const baseX = to.x - ux * head;
  const baseY = to.y - uy * head;
  const half = head * 0.5;
  const headPoints = `${to.x},${to.y} ${baseX - uy * half},${baseY + ux * half} ${baseX + uy * half},${baseY - ux * half}`;

  const onLinePointerDown = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, connector.id);
  };

  const startHandleDrag = (e: ReactPointerEvent<SVGElement>, end: 'from' | 'to') => {
    if (e.button !== 0 || !editable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = end === 'from' ? ends.from : ends.to;
    set({ end, pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startPoint: p, cur: p });
  };
  const worldOf = (d: EndDrag, e: ReactPointerEvent<SVGElement>): Point => ({
    x: d.startPoint.x + (e.clientX - d.startClient.x) / zoom,
    y: d.startPoint.y + (e.clientY - d.startClient.y) / zoom,
  });
  const moveHandle = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) set({ ...d, cur: worldOf(d, e) });
  };
  const endHandleDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    set(null);
    const p = worldOf(d, e);
    const target = rectIdAt(rects, p);
    undo.boundary();
    // Over the object at the opposite end the model refuses and the handle snaps back.
    if (target) setConnectorEndpoint(doc, connector.id, d.end, { kind: 'attached', objectId: target, fallback: p });
    else setConnectorEndpoint(doc, connector.id, d.end, { kind: 'free', x: p.x, y: p.y });
    undo.boundary();
  };

  const handleR = HANDLE_SIZE_PX / 2 / zoom;
  const handle = (end: 'from' | 'to', at: Point) => (
    <circle
      key={end}
      role="button"
      aria-label={end === 'from' ? 'Arrow start handle' : 'Arrow end handle'}
      data-handle={end}
      cx={at.x}
      cy={at.y}
      r={handleR}
      fill="#fff"
      stroke={HANDLE_COLOR}
      strokeWidth={1.5 / zoom}
      pointerEvents="all"
      style={{ cursor: 'move', touchAction: 'none' }}
      onPointerDown={(e) => startHandleDrag(e, end)}
      onPointerMove={moveHandle}
      onPointerUp={endHandleDrag}
      onPointerCancel={() => set(null)}
    />
  );

  return (
    <svg
      width={1}
      height={1}
      data-object-id={connector.id}
      data-connector-id={connector.id}
      data-selected={selected ? 'true' : 'false'}
      data-from={`${from.x},${from.y}`}
      data-to={`${to.x},${to.y}`}
      data-z={connector.z}
      role="group"
      aria-label="Arrow"
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: connector.z }}
    >
      <line x1={from.x} y1={from.y} x2={baseX} y2={baseY} stroke={CONNECTOR_COLOR} strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD} strokeLinecap="butt" />
      <polygon points={headPoints} fill={CONNECTOR_COLOR} />
      <line
        data-testid="connector-hit"
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={(2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom}
        strokeLinecap="round"
        pointerEvents="stroke"
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onLinePointerDown}
      />
      {selected && editable && (
        <>
          {handle('from', from)}
          {handle('to', to)}
        </>
      )}
    </svg>
  );
}
