import { useContext, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
} from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint, type ConnectorSnap, type Endpoint } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import { screenToWorld } from '../canvas/camera';
import { CameraContext } from '../canvas/useCamera';
import { connectorHitTest, type ObjectProps } from './registry';

const HALF = 2;
const SELECTED_COLOR = '#2f6feb';

/** The topmost object (last in (z, id) order) whose rect contains `p`. */
export function objectAtPoint(rects: ReadonlyMap<string, Rect>, p: Point): string | null {
  const entries = [...rects];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (rectContains(entries[i][1], { x: p.x, y: p.y, width: 0, height: 0 })) return entries[i][0];
  }
  return null;
}

/** Arrowhead triangle at `to`, and where the line should stop so it never pokes through the tip. */
export function arrowGeometry(from: Point, to: Point, size = CONNECTOR_ARROWHEAD_SIZE_WORLD) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { lineEnd: to, head: null };
  const ux = dx / len;
  const uy = dy / len;
  const s = Math.min(size, len);
  const base = { x: to.x - ux * s, y: to.y - uy * s };
  const px = -uy * (s / HALF);
  const py = ux * (s / HALF);
  const head = [to, { x: base.x + px, y: base.y + py }, { x: base.x - px, y: base.y - py }];
  return { lineEnd: base, head };
}

interface HandleDrag {
  end: 'from' | 'to';
  pointerId: number;
  startClient: Point;
  startWorld: Point;
  moved: boolean;
}

/**
 * One arrow (story 10, connector.ui): a straight line with an arrowhead at the
 * `to` end. Attached ends are resolved from the objects' current rects on every
 * render, so moves and resizes by anyone redraw it (connector.follow). A press
 * selects it only within CONNECTOR_HIT_TOLERANCE_PX screen pixels of the line
 * (connector.select). When selected, a handle at each end can be dragged onto
 * another object (re-attach) or onto empty space (detach) (connector.reattach).
 */
export function ConnectorObject(props: ObjectProps & { connector?: ConnectorSnap }) {
  const c = (props.connector ?? props.object) as ConnectorSnap;
  const { doc } = props;
  const zoom = props.zoom ?? 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const cameraCtx = useContext(CameraContext);
  const cameraRef = useRef(cameraCtx?.api.camera);
  cameraRef.current = cameraCtx?.api.camera;
  const rectsRef = useRef(props.rects);
  rectsRef.current = props.rects;

  const resolved = props.rects ? resolveEndpoints(c, props.rects) : c.ends;
  const [dragPoint, setDragPoint] = useState<{ end: 'from' | 'to'; p: Point } | null>(null);
  const dragRef = useRef<HandleDrag | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const ends = dragPoint ? { ...resolved, [dragPoint.end]: dragPoint.p } : resolved;
  const { lineEnd, head } = arrowGeometry(ends.from, ends.to);
  const tol = CONNECTOR_HIT_TOLERANCE_PX / zoom;
  const handleR = HANDLE_SIZE_PX / HALF / zoom;
  const pad = Math.max(CONNECTOR_ARROWHEAD_SIZE_WORLD, tol, handleR * HALF) + CONNECTOR_STROKE_WIDTH_WORLD;
  const left = Math.min(ends.from.x, ends.to.x) - pad;
  const top = Math.min(ends.from.y, ends.to.y) - pad;
  const width = Math.abs(ends.to.x - ends.from.x) + pad * HALF;
  const height = Math.abs(ends.to.y - ends.from.y) + pad * HALF;
  const local = (p: Point) => ({ x: p.x - left, y: p.y - top });
  const f = local(ends.from);
  const t = local(ends.to);
  const le = local(lineEnd);
  const color = props.selected ? SELECTED_COLOR : CONNECTOR_COLOR;

  /** Client coordinates → world, through the board camera (null outside a board). */
  const clientToWorld = (clientX: number, clientY: number): Point | null => {
    const camera = cameraRef.current;
    const vp = rootRef.current?.closest('.board-viewport');
    if (!camera || !vp) return null;
    const r = vp.getBoundingClientRect();
    return screenToWorld(camera, { x: clientX - r.left, y: clientY - r.top });
  };

  const onLinePointerDown = (e: PointerEvent<SVGLineElement>) => {
    if (e.button !== 0) return;
    const world = clientToWorld(e.clientX, e.clientY);
    // Only presses close to the line select it, never the rest of its box.
    const live: ConnectorSnap = { ...c, ends: resolved };
    if (world && !connectorHitTest(live, world, zoom)) return;
    e.stopPropagation(); // the board must not pan
    props.onPointerDown(e, c.id);
  };

  const commit = (end: 'from' | 'to', p: Point) => {
    const rects = rectsRef.current ?? new Map<string, Rect>();
    const target = objectAtPoint(rects, p);
    const other = end === 'from' ? c.to : c.from;
    // Onto the object at the other end: rejected, the handle snaps back.
    if (target !== null && other.kind === 'attached' && other.objectId === target) return;
    const next: Endpoint =
      target !== null ? { kind: 'attached', objectId: target, fallback: p } : { kind: 'free', x: p.x, y: p.y };
    undo.boundary();
    // False when the arrow was deleted meanwhile: the interaction just ends.
    setConnectorEndpoint(doc, c.id, end, next);
    undo.boundary();
  };

  const onHandlePointerDown = (e: PointerEvent<SVGCircleElement>, end: 'from' | 'to') => {
    e.stopPropagation();
    if (e.button !== 0 || props.readOnly || dragRef.current) return;
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Unavailable for synthetic events; events still reach the handle.
    }
    dragRef.current = {
      end,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: resolved[end],
      moved: false,
    };
    const pointAt = (ev: globalThis.PointerEvent, d: HandleDrag): Point => ({
      x: d.startWorld.x + (ev.clientX - d.startClient.x) / zoom,
      y: d.startWorld.y + (ev.clientY - d.startClient.y) / zoom,
    });
    const onMove = (ev: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      if (!d.moved && Math.hypot(ev.clientX - d.startClient.x, ev.clientY - d.startClient.y) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      setDragPoint({ end: d.end, p: pointAt(ev, d) });
    };
    const finish = (ev: globalThis.PointerEvent, commitIt: boolean) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      cleanup();
      if (commitIt && d.moved) commit(d.end, pointAt(ev, d));
    };
    const onUp = (ev: globalThis.PointerEvent) => finish(ev, true);
    const onCancel = (ev: globalThis.PointerEvent) => finish(ev, false);
    const cleanup = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
      dragRef.current = null;
      cleanupRef.current = null;
      setDragPoint(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('lostpointercapture', onCancel);
    cleanupRef.current = cleanup;
  };

  const showHandles = props.selected && !props.readOnly;

  return (
    <div
      ref={rootRef}
      className={`connector-object board-object${props.gesture === 'dragging' ? ' is-dragging' : ''}`}
      role="group"
      aria-roledescription="arrow"
      aria-label="Arrow"
      tabIndex={0}
      data-connector-id={c.id}
      data-object-id={c.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.gesture}
      data-from-kind={c.from.kind}
      data-to-kind={c.to.kind}
      data-from-object={c.from.kind === 'attached' ? c.from.objectId : undefined}
      data-to-object={c.to.kind === 'attached' ? c.to.objectId : undefined}
      data-from-x={ends.from.x}
      data-from-y={ends.from.y}
      data-to-x={ends.to.x}
      data-to-y={ends.to.y}
      data-z={c.z}
      style={{ left, top, width, height, zIndex: props.zIndex }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="connector-svg" width={width} height={height} focusable="false">
        <line
          x1={f.x}
          y1={f.y}
          x2={le.x}
          y2={le.y}
          stroke={color}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="butt"
          pointerEvents="none"
          aria-hidden="true"
        />
        {head && (
          <polygon
            points={head.map((p) => `${p.x - left},${p.y - top}`).join(' ')}
            fill={color}
            pointerEvents="none"
            aria-hidden="true"
          />
        )}
        <line
          className="connector-hit"
          data-testid="connector-hit"
          x1={f.x}
          y1={f.y}
          x2={t.x}
          y2={t.y}
          stroke="transparent"
          strokeWidth={tol * HALF}
          strokeLinecap="round"
          pointerEvents="stroke"
          aria-hidden="true"
          onPointerDown={onLinePointerDown}
        />
        {showHandles &&
          (['from', 'to'] as const).map((end) => {
            const p = end === 'from' ? f : t;
            return (
              <circle
                key={end}
                className="connector-handle"
                role="button"
                aria-label={end === 'from' ? 'Arrow start' : 'Arrow end'}
                data-end={end}
                cx={p.x}
                cy={p.y}
                r={handleR * 1.25}
                strokeWidth={1.5 / zoom}
                pointerEvents="all"
                onPointerDown={(e) => onHandlePointerDown(e, end)}
              />
            );
          })}
      </svg>
    </div>
  );
}
