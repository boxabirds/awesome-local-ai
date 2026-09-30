import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  HANDLE_SIZE_PX,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { type Side, SIDES, nearestSide, reference, sideAnchor } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { type ConnectorSnap, type Endpoint, anchorToward, setConnectorEndpoint } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import { screenToWorld } from '../canvas/camera';
import { useBoardCamera } from '../canvas/useCamera';
import { useBoardObjects } from './BoardObjectsContext';
import { attachableObjectAt, attachableRects, viewportPoint } from './hitTest';
import { SHAPE_KIND_NAMES } from './ShapeObject';
import type { ObjectProps } from './types';

const PRIMARY_BUTTON = 0;
const ARROW_COLOR = SHAPE_STROKE_COLORS.dark;
const SELECTED_COLOR = '#1E88E5';

/** The arrowhead triangle at `to` and where the line should stop (its base). */
export function arrowhead(from: Point, to: Point, size = CONNECTOR_ARROWHEAD_SIZE_WORLD): { points: Point[]; base: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { points: [], base: to };
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(size, len);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const half = head / 2;
  return {
    points: [to, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }],
    base,
  };
}

/** A short name for an object an arrow is attached to (screen readers). */
function objectName(o: ObjectSnapshot | undefined): string {
  if (!o) return 'a point';
  if (o.type === 'shape') {
    const kind = o.kind ? SHAPE_KIND_NAMES[o.kind] : 'Shape';
    return o.label ? `${kind} "${o.label}"` : kind;
  }
  if (o.type === 'sticky') return o.text ? `Sticky note "${o.text}"` : 'Sticky note';
  if (o.type === 'text') return o.text ? `Text "${o.text}"` : 'Text';
  return 'an object';
}

function endName(e: Endpoint, snapshot: readonly ObjectSnapshot[]): string {
  return e.kind === 'attached' ? objectName(snapshot.find((o) => o.id === e.objectId)) : 'a point';
}

interface HandleDrag {
  end: 'from' | 'to';
  pointerId: number;
  world: Point;
  /** Object under the pointer (attach target), if any. */
  targetId: string | null;
}

/**
 * An arrow (connector.ui): a straight line with an arrowhead at its end, drawn
 * from the snapshot's resolved ends, so moves and resizes by anyone redraw it.
 * Only a press within CONNECTOR_HIT_TOLERANCE_PX (screen) of the line selects it.
 * When selected, a handle at each end can be dragged onto an object (attach) or
 * empty space (free); dropping on the object at the other end snaps back.
 */
export function ConnectorObject(props: ObjectProps): React.JSX.Element {
  const c = props.object as ConnectorSnap;
  const { doc, zoom } = props;
  const id = c.id;
  const { camera } = useBoardCamera();
  const snapshot = useBoardObjects();
  const undo = useUndoController();
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const dragRef = useRef<HandleDrag | null>(null);

  const rects = attachableRects(snapshot);
  const otherOf = (end: 'from' | 'to') => (end === 'from' ? 'to' : 'from');

  // While a handle is dragged, that end follows the pointer (or snaps to the target's side).
  const ends = { ...c.ends };
  let target: { rect: Rect; side: Side } | null = null;
  if (drag) {
    const other = c[otherOf(drag.end)];
    const t = drag.targetId ? rects.get(drag.targetId) : undefined;
    if (t) {
      const side = nearestSide(t, reference(other, rects));
      ends[drag.end] = sideAnchor(t, side);
      target = { rect: t, side };
    } else {
      ends[drag.end] = drag.world;
    }
  }

  const head = arrowhead(ends.from, ends.to);
  const hitWidth = (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom;
  const handleR = (HANDLE_SIZE_PX / 2 + 1) / zoom;
  const pad = Math.max(CONNECTOR_ARROWHEAD_SIZE_WORLD, hitWidth, handleR * 2) + 2;
  const left = Math.min(ends.from.x, ends.to.x) - pad;
  const top = Math.min(ends.from.y, ends.to.y) - pad;
  const width = Math.abs(ends.to.x - ends.from.x) + 2 * pad;
  const height = Math.abs(ends.to.y - ends.from.y) + 2 * pad;
  const local = (p: Point) => ({ x: p.x - left, y: p.y - top });
  const from = local(ends.from);
  const base = local(head.base);
  const colour = props.selected ? SELECTED_COLOR : ARROW_COLOR;

  const worldAt = (el: Element, clientX: number, clientY: number) =>
    screenToWorld(camera, viewportPoint(el, clientX, clientY));

  const onLinePointerDown = (e: ReactPointerEvent<SVGLineElement>) => {
    if (e.button !== PRIMARY_BUTTON) return;
    // Only close to the line (the box around a diagonal arrow is mostly empty space).
    const world = worldAt(e.currentTarget, e.clientX, e.clientY);
    if (distanceToPolyline([c.ends.from, c.ends.to], world) > CONNECTOR_HIT_TOLERANCE_PX / zoom) return;
    e.stopPropagation();
    props.onPointerDown(e as unknown as ReactPointerEvent<HTMLElement>, id);
  };

  const targetAt = (world: Point): string | null => attachableObjectAt(snapshot, world, zoom)?.id ?? null;

  const updateDrag = (next: HandleDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const onHandleDown = (e: ReactPointerEvent<SVGCircleElement>, end: 'from' | 'to') => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || !props.editable || dragRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    const world = worldAt(e.currentTarget, e.clientX, e.clientY);
    updateDrag({ end, pointerId: e.pointerId, world, targetId: targetAt(world) });
  };

  const onHandleMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const world = worldAt(e.currentTarget, e.clientX, e.clientY);
    updateDrag({ ...d, world, targetId: targetAt(world) });
  };

  const onHandleUp = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    updateDrag(null);
    const world = worldAt(e.currentTarget, e.clientX, e.clientY);
    const hit = attachableObjectAt(snapshot, world, zoom);
    const other = c[otherOf(d.end)];
    // Dropped on the object at the other end: rejected, the handle snaps back.
    if (hit && other.kind === 'attached' && other.objectId === hit.id) return;
    const next: Endpoint = hit
      ? { kind: 'attached', objectId: hit.id, fallback: anchorToward(rects.get(hit.id)!, other, rects) }
      : { kind: 'free', x: world.x, y: world.y };
    undo.boundary();
    // False when the arrow was deleted meanwhile: the interaction just ends.
    setConnectorEndpoint(doc, id, d.end, next);
    undo.boundary();
  };

  const onHandleCancel = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) updateDrag(null);
  };

  const showHandles = props.selected && props.editable && !props.transforming;
  const dotR = CONNECTOR_DOT_RADIUS_PX / zoom;

  return (
    <div
      className={['connector-object', props.selected && 'is-selected'].filter(Boolean).join(' ')}
      role="group"
      aria-label={`Arrow from ${endName(c.from, snapshot)} to ${endName(c.to, snapshot)}`}
      tabIndex={0}
      data-connector-object=""
      data-id={id}
      data-from={c.from.kind}
      data-to={c.to.kind}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={drag ? 'reattaching' : props.transforming ? 'dragging' : 'idle'}
      data-x1={ends.from.x}
      data-y1={ends.from.y}
      data-x2={ends.to.x}
      data-y2={ends.to.y}
      style={{ left, top, width, height, zIndex: c.z }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !props.selected) {
          try {
            if (!e.currentTarget.matches(':focus-visible')) return;
          } catch {
            return;
          }
          props.onSelect(id);
        }
      }}
    >
      <svg className="connector-svg" width={width} height={height} focusable="false">
        <line
          className="connector-hit"
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={local(ends.to).x}
          y2={local(ends.to).y}
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          pointerEvents={drag ? 'none' : 'stroke'}
          aria-hidden="true"
          onPointerDown={onLinePointerDown}
        />
        <line
          className="connector-line"
          x1={from.x}
          y1={from.y}
          x2={base.x}
          y2={base.y}
          stroke={colour}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
          pointerEvents="none"
          aria-hidden="true"
        />
        {head.points.length > 0 && (
          <polygon
            className="connector-head"
            points={head.points.map((p) => `${p.x - left},${p.y - top}`).join(' ')}
            fill={colour}
            pointerEvents="none"
            aria-hidden="true"
          />
        )}
        {target &&
          SIDES.map((side) => {
            const p = local(sideAnchor(target.rect, side));
            const on = side === target.side;
            return (
              <circle
                key={side}
                className={on ? 'connector-dot is-highlighted' : 'connector-dot'}
                data-testid="connector-dot"
                data-side={side}
                data-highlighted={on ? 'true' : 'false'}
                cx={p.x}
                cy={p.y}
                r={on ? dotR * 1.5 : dotR}
                pointerEvents="none"
                aria-hidden="true"
              />
            );
          })}
        {showHandles &&
          (['from', 'to'] as const).map((end) => {
            const p = local(ends[end]);
            return (
              <circle
                key={end}
                className="connector-handle"
                role="button"
                aria-label={end === 'from' ? 'Arrow start' : 'Arrow end'}
                data-end={end}
                cx={p.x}
                cy={p.y}
                r={handleR}
                strokeWidth={1.5 / zoom}
                onPointerDown={(e) => onHandleDown(e, end)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleCancel}
                onLostPointerCapture={onHandleCancel}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            );
          })}
      </svg>
    </div>
  );
}
