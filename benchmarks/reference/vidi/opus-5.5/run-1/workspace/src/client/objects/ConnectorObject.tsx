import {
  memo,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import {
  attachedAnchor,
  nearestSide,
  rectCentre,
  sideAnchor,
  type Endpoint,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { isConnector, setConnectorEndpoint, type ConnectorSnap } from '../../shared/objects/connector';
import { UndoContext } from '../board/useUndo';
import { useBoardObjects } from './boardObjects';
import { attachableAt, type ObjectProps } from './objectTypes';

const HALF = 2;
const PRIMARY_BUTTON = 0;
/** Arrowhead width as a share of its length. */
const ARROWHEAD_WIDTH_RATIO = 0.8;
/** Selection highlight under the line, in screen px. */
const SELECTED_HALO_PX = 6;
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
export const ARROW_LABEL = 'Arrow';
export const HANDLE_LABELS = { from: 'Arrow start', to: 'Arrow end' } as const;

type End = 'from' | 'to';

/** Points of the arrowhead triangle at `tip`, pointing away from `tail`. */
export function arrowheadPoints(tail: Point, tip: Point, size: number): { base: Point; points: Point[] } {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Never longer than the arrow itself.
  const length = Math.min(size, len);
  const half = (length * ARROWHEAD_WIDTH_RATIO) / HALF;
  const base = { x: tip.x - ux * length, y: tip.y - uy * length };
  return {
    base,
    points: [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }],
  };
}

/** An in-progress end-handle drag. */
interface HandleDrag {
  end: End;
  pointerId: number;
  startClient: Point;
  startWorld: Point;
  moved: boolean;
  point: Point;
  target: ObjectSnapshot | undefined;
}

function otherObjectId(c: ConnectorSnap, end: End): string | undefined {
  const other: Endpoint = end === 'from' ? c.to : c.from;
  return other.kind === 'attached' ? other.objectId : undefined;
}

/**
 * One arrow (story 10): a straight line with an arrowhead at its `to` end, drawn between the
 * points the snapshot resolved from the objects' current rects (connector.follow), so any move
 * or resize by anyone redraws it. Presses on the line are routed to it by the board (it takes
 * no pointer events itself, so objects beneath stay clickable away from the line). When
 * selected it shows a handle at each end; dragging one onto an object re-attaches that end,
 * onto empty space detaches it there, onto the object at the other end snaps back
 * (connector.reattach).
 */
function ConnectorObjectImpl(props: ObjectProps) {
  const { object, doc, zoom, stackIndex, selected, dragging, readOnly, onSelect } = props;
  const getObjects = useBoardObjects();
  const undo = useContext(UndoContext);
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const dragRef = useRef<HandleDrag | null>(null);
  const pointerFocusRef = useRef(false);
  if (!isConnector(object)) return null;
  const c = object;

  const worldAt = (d: HandleDrag, e: { clientX: number; clientY: number }): Point => ({
    x: d.startWorld.x + (e.clientX - d.startClient.x) / zoom,
    y: d.startWorld.y + (e.clientY - d.startClient.y) / zoom,
  });

  /** The other end's aim point: where the dragged end's side is chosen toward. */
  const otherAim = (end: End): Point => {
    const other = end === 'from' ? c.to : c.from;
    if (other.kind === 'free') return { x: other.x, y: other.y };
    const obj = getObjects().find((o) => o.id === other.objectId);
    return obj ? rectCentre(objectBounds(obj)) : end === 'from' ? c.toPoint : c.fromPoint;
  };

  const onHandlePointerDown = (e: ReactPointerEvent<SVGElement>, end: End) => {
    // Neither the board (pan, marquee, arrow selection) nor objects below may see this press.
    e.stopPropagation();
    if (readOnly || e.button !== PRIMARY_BUTTON || dragRef.current) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone.
    }
    const startWorld = end === 'from' ? c.fromPoint : c.toPoint;
    const d: HandleDrag = {
      end,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld,
      moved: false,
      point: startWorld,
      target: undefined,
    };
    dragRef.current = d;
    setDrag(d);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const moved = d.moved || Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) >= DRAG_THRESHOLD_PX;
    const point = worldAt(d, e);
    const next: HandleDrag = { ...d, moved, point, target: moved ? attachableAt(getObjects(), point) : undefined };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const onHandlePointerUp = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    endDrag();
    if (!d.moved || readOnly) return;
    const point = worldAt(d, e);
    const target = attachableAt(getObjects(), point);
    // Released on the object at the other end: rejected, the handle snaps back.
    if (target && target.id === otherObjectId(c, d.end)) return;
    const endpoint: Endpoint = target
      ? { kind: 'attached', objectId: target.id, fallback: attachedAnchor(objectBounds(target), otherAim(d.end)) }
      : { kind: 'free', x: point.x, y: point.y };
    undo?.boundary();
    // False when the arrow was deleted meanwhile: the interaction just ends.
    setConnectorEndpoint(doc, c.id, d.end, endpoint);
    undo?.boundary();
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(c.id);
  };

  // Where the ends are drawn: a dragged end follows the pointer, or snaps to the target's side.
  let from = c.fromPoint;
  let to = c.toPoint;
  let targetRect: Rect | null = null;
  let targetSide: Side | null = null;
  if (drag?.moved) {
    let p = drag.point;
    if (drag.target && drag.target.id !== otherObjectId(c, drag.end)) {
      targetRect = objectBounds(drag.target);
      targetSide = nearestSide(targetRect, otherAim(drag.end));
      p = sideAnchor(targetRect, targetSide);
    }
    if (drag.end === 'from') from = p;
    else to = p;
  }

  const head = arrowheadPoints(from, to, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  // The SVG spans the arrow plus room for the arrowhead, halo and handles.
  const pad = CONNECTOR_ARROWHEAD_SIZE_WORLD + (HANDLE_SIZE_PX + CONNECTOR_HIT_TOLERANCE_PX) / zoom;
  const origin = { x: Math.min(from.x, to.x) - pad, y: Math.min(from.y, to.y) - pad };
  const width = Math.abs(from.x - to.x) + pad * HALF;
  const height = Math.abs(from.y - to.y) + pad * HALF;
  const local = (p: Point) => ({ x: p.x - origin.x, y: p.y - origin.y });
  const a = local(from);
  const lineEnd = local(head.base);
  const tip = head.points.map(local);
  const style: CSSProperties = { zIndex: stackIndex };
  const svgStyle: CSSProperties = { left: origin.x, top: origin.y };
  const handleRadius = HANDLE_SIZE_PX / HALF / zoom;
  const dotRadius = CONNECTOR_DOT_RADIUS_PX / zoom;
  const showHandles = selected && !readOnly && !dragging;

  return (
    <div
      className={`connector-object${selected ? ' connector-object--selected' : ''}`}
      role="group"
      aria-roledescription="arrow"
      aria-label={ARROW_LABEL}
      tabIndex={0}
      data-testid="connector-object"
      data-id={c.id}
      data-selected={selected ? 'true' : 'false'}
      data-from-kind={c.from.kind}
      data-to-kind={c.to.kind}
      data-x1={c.fromPoint.x}
      data-y1={c.fromPoint.y}
      data-x2={c.toPoint.x}
      data-y2={c.toPoint.y}
      style={style}
      onFocus={onFocus}
      onPointerDown={() => {
        pointerFocusRef.current = true;
      }}
    >
      <svg
        className="connector-object__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={svgStyle}
        aria-hidden="true"
        focusable="false"
      >
        {selected && (
          <line
            className="connector-object__halo"
            x1={a.x}
            y1={a.y}
            x2={local(to).x}
            y2={local(to).y}
            strokeWidth={SELECTED_HALO_PX / zoom + CONNECTOR_STROKE_WIDTH_WORLD}
          />
        )}
        <line
          data-testid="connector-line"
          x1={a.x}
          y1={a.y}
          x2={lineEnd.x}
          y2={lineEnd.y}
          stroke={CONNECTOR_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="butt"
        />
        <polygon
          data-testid="connector-arrowhead"
          points={tip.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={CONNECTOR_COLOR}
        />
        {targetRect &&
          SIDES.map((side) => {
            const p = local(sideAnchor(targetRect, side));
            const lit = side === targetSide;
            return (
              <circle
                key={side}
                className={`connection-dot${lit ? ' connection-dot--highlighted' : ''}`}
                data-testid="connection-dot"
                data-side={side}
                data-highlighted={lit ? 'true' : 'false'}
                cx={p.x}
                cy={p.y}
                r={dotRadius}
                strokeWidth={1 / zoom}
              />
            );
          })}
        {showHandles &&
          (['from', 'to'] as const).map((end) => {
            const p = local(end === 'from' ? from : to);
            return (
              <circle
                key={end}
                className="connector-handle"
                role="button"
                aria-label={HANDLE_LABELS[end]}
                data-testid="connector-handle"
                data-connector-handle={end}
                data-end={end}
                cx={p.x}
                cy={p.y}
                r={handleRadius}
                strokeWidth={1 / zoom}
                onPointerDown={(e) => onHandlePointerDown(e, end)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={endDrag}
                onLostPointerCapture={(e) => {
                  if (dragRef.current?.pointerId === e.pointerId) endDrag();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            );
          })}
      </svg>
    </div>
  );
}

export const ConnectorObject = memo(ConnectorObjectImpl);
