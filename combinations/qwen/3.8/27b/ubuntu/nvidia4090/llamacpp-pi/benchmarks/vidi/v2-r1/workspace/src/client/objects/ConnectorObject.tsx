// ConnectorObject (story 10, connector.ui): renders an arrow — an SVG line
// with an arrowhead — between its two endpoints, plus the two end handles
// while selected.
//
//  - The endpoints resolve against the current object rects on every render
//    (connector.follow): attached ends sit at the midpoint of the nearest
//    side, free ends at their stored point.
//  - Selection: a press within CONNECTOR_HIT_TOLERANCE_PX (screen) of the
//    line goes through the invisible wide hit line to the generic gesture
//    (connector.select). The visible line itself never catches the pointer.
//  - Move/resize: the arrow follows its objects with no writes; selecting
//    the arrow shows no resize handles (its ends move only via the handles).
//  - End handles (connector.reattach): dragging a handle and releasing over
//    a board object attaches the end there; over empty space it detaches at
//    the release point; over the object at the other end (or the arrow
//    itself) it snaps back with no write. A stale arrow (deleted remotely
//    mid-drag) simply ends the interaction.

import { useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_COLOR,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import { setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import {
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import { screenToWorld } from '../canvas/camera';
import type { Point, Rect } from '../../shared/geometry';
// The circular registry import is safe: `objectAtPoint` is only referenced
// inside event handlers, by which time both modules are fully evaluated.
import { objectAtPoint, type ObjectProps } from './registry';

interface DragPreview {
  end: 'from' | 'to';
  /** The current pointer position in world units. */
  point: Point;
}

/** The other end of the arrow, used for fallback anchors and rejection. */
function otherEndpointOf(conn: { from?: Endpoint; to?: Endpoint }, end: 'from' | 'to'): Endpoint | null {
  const other = end === 'from' ? conn.to : conn.from;
  return other ?? null;
}

function otherEndPosition(
  other: Endpoint | null,
  rects: ReadonlyMap<string, Rect> | undefined,
): Point | null {
  if (other === null || other === undefined) return null;
  if (other.kind === 'free') return { x: other.x, y: other.y };
  if (rects !== undefined && rects.has(other.objectId)) {
    // The centre of the attached object is the anchor reference.
    const r = rects.get(other.objectId)!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return { x: other.fallback.x, y: other.fallback.y };
}

export function ConnectorObject(props: ObjectProps): JSX.Element | null {
  const { obj, doc, zoom, selected, canEdit, onPointerDown, camera, rects, snapshot, undo } =
    props;

  const [preview, setPreview] = useState<DragPreview | null>(null);

  // The reattach-drag handlers are registered once on pointerdown; they must
  // read the latest snapshot/camera/rects/object at release, because a remote
  // change (e.g. a delete) may have landed mid-drag. Keep live refs updated
  // on every render.
  const latestSnapshot = useRef(snapshot);
  const latestCamera = useRef(camera);
  const latestRects = useRef(rects);
  const latestObj = useRef(obj);
  latestSnapshot.current = snapshot;
  latestCamera.current = camera;
  latestRects.current = rects;
  latestObj.current = obj;

  if (obj.type !== 'connector') return null;
  const conn = obj as { from?: Endpoint; to?: Endpoint };
  if (conn.from === undefined || conn.to === undefined) return null;

  // Resolved endpoint points: prefer the snapshot's derivation (which used
  // the same rects map this render received); fall back to resolving here.
  const pts =
    obj.fromPoint !== undefined && obj.toPoint !== undefined
      ? { from: obj.fromPoint, to: obj.toPoint }
      : resolveEndpoints({ from: conn.from, to: conn.to }, rects ?? new Map());

  const bb: Rect = { x: obj.x, y: obj.y, width: obj.width ?? 0, height: obj.height ?? 0 };
  // The hit line and the handles overflow the bbox; pad the SVG so they stay
  // inside it (the world layer clips nothing, but the SVG viewport would).
  const pad = CONNECTOR_HIT_TOLERANCE_PX / zoom + CONNECTOR_DOT_RADIUS_PX + 4;
  const ox = bb.x - pad;
  const oy = bb.y - pad;
  const W = bb.width + 2 * pad;
  const H = bb.height + 2 * pad;
  const L = (p: Point): Point => ({ x: p.x - ox, y: p.y - oy });
  const fromL = L(pts.from);
  const toL = L(pts.to);

  // Arrowhead: a closed triangle at the `to` end pointing toward `from`.
  const dx = toL.x - fromL.x;
  const dy = toL.y - fromL.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const A = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const hw = A / 2;
  const bx = toL.x - ux * A;
  const by = toL.y - uy * A;
  const nx = -uy;
  const ny = ux;
  const arrowheadPoints = `${toL.x},${toL.y} ${bx + nx * hw},${by + ny * hw} ${bx - nx * hw},${by - ny * hw}`;

  const handleR = CONNECTOR_DOT_RADIUS_PX / zoom;

  /** Press on the line body: select via the generic gesture. */
  const onBodyPointerDown = (e: React.PointerEvent<SVGLineElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    onPointerDown(e, obj.id);
  };

  /** Press on an end handle: start a re-attach drag (connector.reattach). */
  const startHandleDrag = (end: 'from' | 'to') => (e: React.PointerEvent<SVGCircleElement>) => {
    if (!canEdit || camera === undefined) return;
    e.stopPropagation();
    e.preventDefault();
    const pid = e.pointerId;
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(pid);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }

    const viewportRect = (): { left: number; top: number } => {
      const v = document.querySelector('[data-testid="board-viewport"]');
      const r = v ? v.getBoundingClientRect() : null;
      return r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
    };
    const toWorld = (clientX: number, clientY: number): Point => {
      const r = viewportRect();
      const cam = latestCamera.current;
      const pt = { x: clientX - r.left, y: clientY - r.top };
      return cam !== undefined ? screenToWorld(cam, pt) : pt;
    };

    let moved = false;
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      moved = true;
      setPreview({ end, point: toWorld(ev.clientX, ev.clientY) });
    };
    const finish = (ev: PointerEvent, cancelled: boolean): void => {
      cleanup();
      if (!moved) {
        // A plain click on the handle: nothing happens.
        setPreview(null);
        return;
      }
      if (cancelled) {
        setPreview(null);
        return;
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const cam = latestCamera.current;
      const snap = latestSnapshot.current;
      const rectsNow = latestRects.current;
      const objNow = latestObj.current;
      const connNow = objNow as { from?: Endpoint; to?: Endpoint };
      const target =
        snap !== undefined && cam !== undefined ? objectAtPoint(snap, w, cam.zoom) : null;
      const other = otherEndpointOf(connNow, end);
      const otherId = other !== null && other.kind === 'attached' ? other.objectId : null;
      // Rejection: the other end's object or the arrow itself.
      if (target !== null && (target.id === objNow.id || target.id === otherId)) {
        setPreview(null);
        return;
      }
      if (target !== null) {
        const r = objectBounds(target);
        const otherPos = otherEndPosition(other, rectsNow);
        const fallback = sideAnchor(
          r,
          otherPos !== null ? nearestSide(r, otherPos) : 'right',
        );
        undo?.boundary();
        setConnectorEndpoint(doc, objNow.id, end, {
          kind: 'attached',
          objectId: target.id,
          fallback,
        });
        undo?.boundary();
      } else {
        // No object under the release point (it may have been deleted while
        // the drag was held): detach the end at the release point.
        undo?.boundary();
        setConnectorEndpoint(doc, objNow.id, end, { kind: 'free', x: w.x, y: w.y });
        undo?.boundary();
      }
      setPreview(null);
    };
    const onUp = (ev: PointerEvent): void => finish(ev, false);
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      finish(ev, true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  let previewFrom: Point = toL;
  let previewTo: Point = fromL;
  if (preview !== null) {
    const previewL = L(preview.point);
    if (preview.end === 'from') {
      previewFrom = previewL;
    } else {
      previewTo = previewL;
    }
  }

  return (
    <div
      className={`connector-object${selected ? ' connector-object--selected' : ''}`}
      data-testid="connector-object"
      data-id={obj.id}
      role="group"
      aria-label={selected ? 'Selected arrow' : 'Arrow'}
      tabIndex={0}
      data-selected={selected || undefined}
      style={{
        left: ox,
        top: oy,
        width: W,
        height: H,
        zIndex: obj.z,
        pointerEvents: 'none',
      }}
    >
      <svg
        data-testid="connector-svg"
        width={W}
        height={H}
        style={{ overflow: 'visible', display: 'block' }}
        aria-hidden="true"
      >
        {/* Invisible wide hit line: the only part of the arrow that catches
            the pointer (connector.select). The visible line is decorative. */}
        <line
          data-testid="connector-hitline"
          x1={fromL.x}
          y1={fromL.y}
          x2={toL.x}
          y2={toL.y}
          stroke="rgba(0,0,0,0)"
          strokeWidth={(2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={onBodyPointerDown}
        />
        <line
          data-testid="connector-line"
          x1={fromL.x}
          y1={fromL.y}
          x2={toL.x}
          y2={toL.y}
          stroke={CONNECTOR_STROKE_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          style={{ pointerEvents: 'none' }}
        />
        <polygon
          data-testid="connector-arrowhead"
          points={arrowheadPoints}
          fill={CONNECTOR_STROKE_COLOR}
          style={{ pointerEvents: 'none' }}
        />
        {preview !== null && (
          <line
            data-testid="connector-preview"
            x1={previewFrom.x}
            y1={previewFrom.y}
            x2={previewTo.x}
            y2={previewTo.y}
            stroke={CONNECTOR_STROKE_COLOR}
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
            strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            style={{ pointerEvents: 'none' }}
          />
        )}
        {selected && canEdit && (
          <>
            <circle
              data-testid="connector-handle-from"
              cx={fromL.x}
              cy={fromL.y}
              r={handleR}
              fill="#ffffff"
              stroke={CONNECTOR_STROKE_COLOR}
              strokeWidth={1.5 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandleDrag('from')}
            />
            <circle
              data-testid="connector-handle-to"
              cx={toL.x}
              cy={toL.y}
              r={handleR}
              fill="#ffffff"
              stroke={CONNECTOR_STROKE_COLOR}
              strokeWidth={1.5 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandleDrag('to')}
            />
          </>
        )}
      </svg>
    </div>
  );
}
