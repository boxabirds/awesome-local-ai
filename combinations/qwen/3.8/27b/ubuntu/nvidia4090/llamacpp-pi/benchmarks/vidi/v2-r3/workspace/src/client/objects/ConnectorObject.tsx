import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  HANDLE_SIZE_PX,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { connectorBBox, nearestSide, resolveEndpoints, sideAnchor } from '../../shared/geometry/connector-geometry';
import {
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../shared/objects/connector';
import type { ObjectProps } from './registry';

/** The connector line colour (dark, matching the default shape outline). */
const LINE_COLOR = '#263238';
/** The colour of a selected connector. */
const SELECTED_COLOR = '#1a73e8';

/**
 * The topmost id whose stored bounds contain `p` (rects is built from the
 * z-sorted snapshot, so iterate in reverse), or null.
 */
function objectIdAt(rects: ReadonlyMap<string, Rect>, p: Point): string | null {
  const entries = [...rects.entries()];
  for (let i = entries.length - 1; i >= 0; i--) {
    const [id, r] = entries[i];
    if (p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height) return id;
  }
  return null;
}

interface DragState {
  end: 'from' | 'to';
  startClient: Point;
  startWorld: Point;
  pos: Point;
}

/**
 * Story 10 (connectors): a connector (arrow) between two endpoints.
 *
 * The line is resolved live: attached endpoints sit at the midpoint of their
 * target's side nearest the other end (so the arrow follows when a target
 * moves); an endpoint whose target is absent renders at its stored fallback.
 * The arrowhead points at the "to" end.
 *
 * Hit test: a wide (2 × CONNECTOR_HIT_TOLERANCE_PX screen px) invisible
 * stroke over the line, at any zoom.
 *
 * A selected connector shows a handle at each end. Dragging a handle moves
 * the displayed endpoint with the pointer (delta-based, like the transform
 * gesture) and, on release, re-attaches it to the object under the pointer
 * (or frees it at the release point) — one undo step per re-attach.
 */
export function ConnectorObject(props: ObjectProps): ReactElement {
  const { obj, doc, zoom, selected, editable } = props;
  const conn = obj as ConnectorSnap;
  const id = obj.id;
  const rects = props.rects;

  const { from, to } = resolveEndpoints({ from: conn.from, to: conn.to }, rects);

  // The endpoint currently being dragged (follows the pointer).
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const propsRef = useRef(props);
  propsRef.current = props;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const resolvedRef = useRef({ from, to });
  resolvedRef.current = { from, to };

  const dispFrom = drag?.end === 'from' ? drag.pos : from;
  const dispTo = drag?.end === 'to' ? drag.pos : to;

  // Render box: the bbox of the displayed endpoints, padded for the hit
  // stroke (screen px → world).
  const pad = (CONNECTOR_HIT_TOLERANCE_PX + CONNECTOR_STROKE_WIDTH_WORLD) / zoom;
  const b = connectorBBox(dispFrom, dispTo);
  const box = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
  const lx = (p: Point) => p.x - box.x;
  const ly = (p: Point) => p.y - box.y;

  // Arrowhead at the "to" end, pointing back toward the "from" end.
  const length = Math.hypot(dispTo.x - dispFrom.x, dispTo.y - dispFrom.y);
  let arrowPoints = '';
  if (length > 1e-6) {
    const a = Math.atan2(dispTo.y - dispFrom.y, dispTo.x - dispFrom.x);
    const L = CONNECTOR_ARROWHEAD_SIZE_WORLD;
    const p2 = { x: dispTo.x - L * Math.cos(a - Math.PI / 7), y: dispTo.y - L * Math.sin(a - Math.PI / 7) };
    const p3 = { x: dispTo.x - L * Math.cos(a + Math.PI / 7), y: dispTo.y - L * Math.sin(a + Math.PI / 7) };
    arrowPoints = `${lx(dispTo)},${ly(dispTo)} ${lx(p2)},${ly(p2)} ${lx(p3)},${ly(p3)}`;
  }

  const color = selected ? SELECTED_COLOR : LINE_COLOR;
  const hitWidth = (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom;
  const handleSize = HANDLE_SIZE_PX / zoom;
  const half = handleSize / 2;
  const handleBorderW = 1.5 / zoom;

  const onHitPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    props.onObjectPointerDown(e, id);
  };

  const beginHandleDrag = (e: React.PointerEvent, end: 'from' | 'to') => {
    e.stopPropagation();
    if (!editable) return;
    const startWorld = end === 'from' ? from : to; // the pointer is on this handle
    setDrag({ end, startClient: { x: e.clientX, y: e.clientY }, startWorld, pos: startWorld });
  };

  // Window-level drag tracking (the gesture is one undo step).
  useEffect(() => {
    if (drag === null) return;
    const end = drag.end;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.end !== end) return;
      const z = zoomRef.current;
      setDrag({
        ...d,
        pos: { x: d.startWorld.x + (e.clientX - d.startClient.x) / z, y: d.startWorld.y + (e.clientY - d.startClient.y) / z },
      });
    };
    const finish = (e: PointerEvent, cancel: boolean) => {
      const d = dragRef.current;
      if (!d || d.end !== end) return;
      setDrag(null);
      if (cancel) return; // pointercancel keeps the last state
      const z = zoomRef.current;
      const pos = {
        x: d.startWorld.x + (e.clientX - d.startClient.x) / z,
        y: d.startWorld.y + (e.clientY - d.startClient.y) / z,
      };
      const { from: rf, to: rt } = resolvedRef.current;
      const other = end === 'from' ? rt : rf;
      const targetId = objectIdAt(propsRef.current.rects, pos);
      const targetRect = targetId ? propsRef.current.rects.get(targetId) : undefined;
      const endpoint: Endpoint =
        targetId && targetRect
          ? {
              kind: 'attached',
              objectId: targetId,
              fallback: sideAnchor(targetRect, nearestSide(targetRect, other)),
            }
          : { kind: 'free', x: pos.x, y: pos.y };
      const p = propsRef.current;
      p.undo.boundary();
      setConnectorEndpoint(p.doc, p.obj.id, end, endpoint);
      p.undo.boundary();
    };
    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [drag?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-connector-id={id}
      data-object-id={id}
      {...(selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        pointerEvents: 'none',
      }}
      onPointerDown={onHitPointerDown}
    >
      <svg
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <line
          x1={lx(dispFrom)}
          y1={ly(dispFrom)}
          x2={lx(dispTo)}
          y2={ly(dispTo)}
          stroke={color}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
          data-connector-line="true"
          style={{ pointerEvents: 'none' }}
        />
        {arrowPoints && <polygon points={arrowPoints} fill={color} style={{ pointerEvents: 'none' }} />}
        {/* the wide invisible hit stroke (6 screen px either side of the line) */}
        <line
          x1={lx(dispFrom)}
          y1={ly(dispFrom)}
          x2={lx(dispTo)}
          y2={ly(dispTo)}
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          data-connector-hit="true"
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
        />
      </svg>
      {selected && (
        <>
          <Handle
            end="from"
            pos={dispFrom}
            origin={box}
            size={handleSize}
            half={half}
            borderW={handleBorderW}
            color={color}
            onPointerDown={beginHandleDrag}
          />
          <Handle
            end="to"
            pos={dispTo}
            origin={box}
            size={handleSize}
            half={half}
            borderW={handleBorderW}
            color={color}
            onPointerDown={beginHandleDrag}
          />
        </>
      )}
    </div>
  );
}

function Handle(props: {
  end: 'from' | 'to';
  pos: Point;
  origin: { x: number; y: number };
  size: number;
  half: number;
  borderW: number;
  color: string;
  onPointerDown(e: React.PointerEvent, end: 'from' | 'to'): void;
}): ReactElement {
  return (
    <div
      role="button"
      aria-label={props.end === 'from' ? 'Connector start handle' : 'Connector end handle'}
      data-connector-handle={props.end}
      onPointerDown={(e) => props.onPointerDown(e, props.end)}
      style={{
        position: 'absolute',
        left: props.pos.x - props.origin.x - props.half,
        top: props.pos.y - props.origin.y - props.half,
        width: props.size,
        height: props.size,
        background: '#fff',
        border: `${props.borderW}px solid ${props.color}`,
        borderRadius: '50%',
        pointerEvents: 'auto',
        cursor: 'grab',
        boxSizing: 'border-box',
      }}
    />
  );
}
