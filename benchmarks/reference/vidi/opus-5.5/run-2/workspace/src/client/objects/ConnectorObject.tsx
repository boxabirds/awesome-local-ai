/**
 * One arrow in the world layer (anchors: connector.ui, connector.follow, connector.select,
 * connector.reattach, connector.target_deleted).
 *
 * A straight line with an arrowhead at its `to` end. Both ends are resolved from the
 * current rects on every render, so a move or resize by anyone redraws the arrow, and
 * detached or orphaned ends draw at their stored points. Only a band of
 * CONNECTOR_HIT_TOLERANCE_PX screen pixels around the line takes pointer input (a press
 * elsewhere in its bounding box reaches whatever is underneath); that press goes to the
 * generic transform gesture like any other object. A selected arrow shows a handle at each
 * end: dragging one onto an object re-attaches that end, onto empty space frees it, onto the
 * object at the other end snaps back.
 */
import { useContext, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { isStickySnapshot, type ObjectSnapshot } from '../../shared/board-model';
import {
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../shared/objects/connector';
import { isShapeSnap } from '../../shared/objects/shape';
import { isTextSnapshot } from '../../shared/objects/text';
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
import { nearestSide, resolveEndpoints, sideAnchor, SIDES } from '../../shared/geometry/connector-geometry';
import { BoardContext } from '../canvas/BoardContext';
import { screenToWorld } from '../canvas/camera';
import { UndoContext } from '../board/useUndo';
import { BoardObjectsContext } from './BoardObjectsContext';
import { connectableAt, getObjectType, type ObjectProps } from './registry';
import { SHAPE_KIND_NAMES } from './ShapeObject';

const HALF = 2;
const PRIMARY_BUTTON = 0;
/** Arrowhead half-width relative to its length. */
const ARROWHEAD_SPREAD = 0.5;
/** Extra room around the drawing, in world units, so strokes and handles are never clipped. */
const PAD_MARGIN = 2;

export type ConnectorEnd = 'from' | 'to';

export interface ConnectorObjectProps extends Partial<Omit<ObjectProps, 'object' | 'doc' | 'selected' | 'zoom'>> {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
}

interface HandleDrag {
  end: ConnectorEnd;
  /** Pointer position in world units. */
  point: Point;
  /** Object under the pointer the end would attach to. */
  target: ObjectSnapshot | null;
}

/** What an end is attached to, for the accessible name. */
function endName(e: Endpoint, objects: readonly ObjectSnapshot[]): string {
  if (e.kind === 'free') return 'a point on the board';
  const o = objects.find((x) => x.id === e.objectId);
  if (o === undefined) return 'a point on the board';
  if (isShapeSnap(o)) return o.label.trim() !== '' ? o.label.trim() : SHAPE_KIND_NAMES[o.kind].toLowerCase();
  if (isStickySnapshot(o)) return o.text.trim() !== '' ? o.text.trim() : 'a sticky note';
  if (isTextSnapshot(o)) return o.text.trim() !== '' ? o.text.trim() : 'a text';
  return 'an object';
}

export function arrowLabel(c: ConnectorSnap, objects: readonly ObjectSnapshot[]): string {
  return `Arrow from ${endName(c.from, objects)} to ${endName(c.to, objects)}`;
}

/** Arrowhead triangle at `to`, pointing away from `from`, and where the line should stop. */
function arrowhead(from: Point, to: Point): { points: string; lineEnd: Point } {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return { points: '', lineEnd: to };
  const size = Math.min(CONNECTOR_ARROWHEAD_SIZE_WORLD, len);
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const base = { x: to.x - ux * size, y: to.y - uy * size };
  const spread = size * ARROWHEAD_SPREAD;
  const left = { x: base.x - uy * spread, y: base.y + ux * spread };
  const right = { x: base.x + uy * spread, y: base.y - ux * spread };
  return { points: `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`, lineEnd: base };
}

export function ConnectorObject(props: ConnectorObjectProps): React.JSX.Element {
  const { connector: c, rects, doc, selected, zoom } = props;
  const editable = props.editable ?? true;
  const board = useContext(BoardContext);
  const { objects } = useContext(BoardObjectsContext);
  const history = useContext(UndoContext);
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const latest = useRef({ c, objects, zoom, board, doc, history });
  latest.current = { c, objects, zoom, board, doc, history };

  // An arrow removed mid-drag (deleted by someone else) ends the interaction.
  useEffect(() => () => detach.current?.(), []);

  // The dragged end previews where it would go; the other end re-faces it.
  const endpoints = { from: c.from, to: c.to };
  if (drag !== null) {
    endpoints[drag.end] =
      drag.target !== null
        ? { kind: 'attached', objectId: drag.target.id, fallback: drag.point }
        : { kind: 'free', x: drag.point.x, y: drag.point.y };
  }
  const { from, to } = resolveEndpoints(endpoints, rects);

  const toWorld = (clientX: number, clientY: number, el: Element): Point | null => {
    const cam = latest.current.board?.board.camera;
    if (cam === undefined) return null;
    const vp = el.closest('.board-viewport')?.getBoundingClientRect();
    return screenToWorld(cam, { x: clientX - (vp?.left ?? 0), y: clientY - (vp?.top ?? 0) });
  };

  const onLinePointerDown = (e: PointerEvent<SVGElement>) => {
    if (e.button !== PRIMARY_BUTTON) return;
    // The stroke band is the hit area; still confirm the distance (connector.select).
    const p = toWorld(e.clientX, e.clientY, e.currentTarget);
    const spec = getObjectType(c.type);
    if (p !== null && spec !== undefined && !spec.hitTest(c, p, zoom)) return;
    e.stopPropagation();
    props.onPointerDown?.(e as unknown as PointerEvent<HTMLElement>, c.id);
  };

  const onHandlePointerDown = (end: ConnectorEnd) => (e: PointerEvent<SVGElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== PRIMARY_BUTTON || !editable) return;
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    const pointerId = e.pointerId;
    const start = { x: e.clientX, y: e.clientY };
    let active = false;
    let last: HandleDrag | null = null;

    const locate = (ev: globalThis.PointerEvent): HandleDrag | null => {
      const point = toWorld(ev.clientX, ev.clientY, el);
      if (point === null) return null;
      const { objects: objs, zoom: z, c: current } = latest.current;
      const target = connectableAt(objs, point, z, current.id) ?? null;
      return { end, point, target };
    };
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      active = true;
      last = locate(ev);
      setDrag(last);
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      detach.current = null;
      setDrag(null);
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (active) last = locate(ev) ?? last;
      finish();
      if (!active || last === null) return;
      const { doc: d, history: h, c: current } = latest.current;
      const other = current[end === 'from' ? 'to' : 'from'];
      // Dropped on the object at the other end: rejected, the handle snaps back.
      if (last.target !== null && other.kind === 'attached' && other.objectId === last.target.id) return;
      const next: Endpoint =
        last.target !== null
          ? { kind: 'attached', objectId: last.target.id, fallback: last.point }
          : { kind: 'free', x: last.point.x, y: last.point.y };
      h.boundary();
      setConnectorEndpoint(d, current.id, end, next); // false when the arrow is gone: nothing to do
      h.boundary();
    };
    const onCancel = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    detach.current?.();
    detach.current = finish;
  };

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !selected) props.onSelect?.(c.id);
  };

  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / zoom;
  const handleR = HANDLE_SIZE_PX / zoom;
  const pad = Math.max(CONNECTOR_ARROWHEAD_SIZE_WORLD, tolerance, handleR) + PAD_MARGIN;
  const left = Math.min(from.x, to.x) - pad;
  const top = Math.min(from.y, to.y) - pad;
  const width = Math.abs(to.x - from.x) + HALF * pad;
  const height = Math.abs(to.y - from.y) + HALF * pad;
  const head = arrowhead(from, to);
  const style: CSSProperties = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    zIndex: c.z,
  };
  const target = drag?.target ?? null;
  const targetRect = target === null ? undefined : rects.get(target.id);
  const highlighted =
    targetRect === undefined ? null : nearestSide(targetRect, drag?.end === 'from' ? to : from);
  const state = drag !== null ? 'reattaching' : props.transforming === true ? 'dragging' : selected ? 'selected' : 'unselected';

  return (
    <div
      className="connector-object"
      role="group"
      aria-roledescription="arrow"
      aria-label={arrowLabel(c, objects)}
      tabIndex={0}
      data-id={c.id}
      data-type="connector"
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      data-from-kind={c.from.kind}
      data-to-kind={c.to.kind}
      data-x1={from.x}
      data-y1={from.y}
      data-x2={to.x}
      data-y2={to.y}
      style={style}
      onFocus={onFocus}
    >
      <svg className="connector-svg" width={width} height={height} focusable="false">
        <g transform={`translate(${-left} ${-top})`}>
          <line
            className="connector-hit"
            aria-hidden="true"
            data-testid="connector-hit"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="transparent"
            strokeWidth={HALF * tolerance}
            strokeLinecap="round"
            onPointerDown={onLinePointerDown}
            onDoubleClick={(e) => e.stopPropagation()}
          />
          <line
            className="connector-line"
            aria-hidden="true"
            x1={from.x}
            y1={from.y}
            x2={head.lineEnd.x}
            y2={head.lineEnd.y}
            stroke={selected ? 'var(--selection)' : CONNECTOR_COLOR}
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
            strokeLinecap="round"
          />
          {head.points !== '' && (
            <polygon
              className="connector-arrowhead"
              aria-hidden="true"
              points={head.points}
              fill={selected ? 'var(--selection)' : CONNECTOR_COLOR}
            />
          )}
          {targetRect !== undefined &&
            SIDES.map((s) => {
              const p = sideAnchor(targetRect, s);
              return (
                <circle
                  key={s}
                  className="connection-dot"
                  aria-hidden="true"
                  data-testid="connection-dot"
                  data-side={s}
                  data-highlighted={s === highlighted ? 'true' : 'false'}
                  cx={p.x}
                  cy={p.y}
                  r={CONNECTOR_DOT_RADIUS_PX / zoom}
                  strokeWidth={1 / zoom}
                />
              );
            })}
          {selected &&
            editable &&
            (['from', 'to'] as const).map((end) => {
              const p = end === 'from' ? from : to;
              return (
                <circle
                  key={end}
                  className="connector-handle"
                  role="button"
                  aria-label={end === 'from' ? 'Arrow start' : 'Arrow end'}
                  data-end={end}
                  cx={p.x}
                  cy={p.y}
                  r={handleR / HALF}
                  strokeWidth={1.5 / zoom}
                  onPointerDown={onHandlePointerDown(end)}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              );
            })}
        </g>
      </svg>
    </div>
  );
}
