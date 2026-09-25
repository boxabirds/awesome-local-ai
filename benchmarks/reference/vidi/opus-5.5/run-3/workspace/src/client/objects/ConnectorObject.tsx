import { memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { nearestSide, resolveEndpoints, sideAnchor } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import {
  attachableRects,
  isConnector,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../shared/objects/connector';
import { BoardContext } from '../board/BoardContext';
import { asStep, UndoContext } from '../board/useUndo';
import { WorldOverlayContext } from '../canvas/worldOverlay';
import { attachTargetAt, rectOf } from '../tools/connectorTargets';
import type { ObjectProps } from './registry';

const LINE_COLOUR = SHAPE_STROKE_COLORS.dark;
const SELECTED_COLOUR = '#3b6cf6';

/** The registry's hit test for arrows: within CONNECTOR_HIT_TOLERANCE_PX on screen of the line (connector.select). */
export function connectorHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  if (!isConnector(obj)) return false;
  return distanceToPolyline(obj.ends, p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

/** The arrowhead triangle at `to` and the point where the line meets its base. */
export function arrowhead(from: Point, to: Point): { points: string; base: Point } {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return { points: '', base: to };
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const size = Math.min(CONNECTOR_ARROWHEAD_SIZE_WORLD, len);
  const base = { x: to.x - ux * size, y: to.y - uy * size };
  const half = size / 2;
  const l = { x: base.x - uy * half, y: base.y + ux * half };
  const r = { x: base.x + uy * half, y: base.y - ux * half };
  return { points: `${to.x},${to.y} ${l.x},${l.y} ${r.x},${r.y}`, base };
}

type End = 'from' | 'to';

/**
 * An arrow in the world layer: a straight line from its start to an arrowhead at its end, both resolved from the
 * current rects on every render, so moves and resizes by anyone redraw it and a vanished object's end is drawn at
 * its fallback. Only a press within CONNECTOR_HIT_TOLERANCE_PX of the line reaches it. When selected, each end has
 * a handle: dropping it on an object attaches that end, on empty space frees it there, on the object at the other
 * end snaps it back.
 */
export function ConnectorObject(props: {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  editable?: boolean;
  stackIndex?: number;
  label?: string;
  onPointerDown?(e: ReactPointerEvent): void;
  onSelect?(): void;
}) {
  const { connector: c, rects, doc, selected, zoom } = props;
  const overlay = useContext(WorldOverlayContext);
  const board = useContext(BoardContext);
  const undo = useContext(UndoContext);
  const [dragging, setDragging] = useState<{ end: End; at: Point } | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  const resolved = resolveEndpoints(c, rects);
  const from = dragging?.end === 'from' ? dragging.at : resolved.from;
  const to = dragging?.end === 'to' ? dragging.at : resolved.to;
  const head = arrowhead(from, to);
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / zoom;
  const pad = tolerance + CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_STROKE_WIDTH_WORLD;
  const box = {
    x: Math.min(from.x, to.x) - pad,
    y: Math.min(from.y, to.y) - pad,
    width: Math.abs(to.x - from.x) + 2 * pad,
    height: Math.abs(to.y - from.y) + 2 * pad,
  };
  const colour = selected ? SELECTED_COLOUR : LINE_COLOUR;
  const latest = useRef({ c, board, doc, undo, zoom });
  latest.current = { c, board, doc, undo, zoom };

  const onLinePointerDown = (e: ReactPointerEvent) => {
    // A press farther than the tolerance from the line is not on the arrow (connector.select).
    const p = board.toWorld(e.clientX, e.clientY);
    if (distanceToPolyline([from, to], p) > tolerance) return;
    e.stopPropagation();
    props.onPointerDown?.(e);
  };

  const beginHandleDrag = (e: ReactPointerEvent, end: End) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    detachRef.current?.();
    const pointerId = e.pointerId;
    setDragging({ end, at: board.toWorld(e.clientX, e.clientY) });
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      setDragging({ end, at: latest.current.board.toWorld(ev.clientX, ev.clientY) });
    };
    const finish = (ev: PointerEvent, release: boolean) => {
      if (ev.pointerId !== pointerId) return;
      detach();
      setDragging(null);
      if (release) dropEnd(end, latest.current.board.toWorld(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => finish(ev, true);
    const cancel = (ev: PointerEvent) => finish(ev, false);
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      detachRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    detachRef.current = detach;
  };

  const dropEnd = (end: End, p: Point) => {
    const { c: cur, board: b, doc: d, undo: u, zoom: z } = latest.current;
    const other = end === 'from' ? cur.to : cur.from;
    const target = attachTargetAt(b.objects, p, z);
    if (target && other.kind === 'attached' && other.objectId === target.id) return; // snaps back
    let next: Endpoint;
    if (target) {
      const r = rectOf(target);
      const ends = resolveEndpoints(cur, attachableRects(b.objects));
      const otherPoint = end === 'from' ? ends.to : ends.from;
      next = { kind: 'attached', objectId: target.id, fallback: sideAnchor(r, nearestSide(r, otherPoint)) };
    } else {
      next = { kind: 'free', x: p.x, y: p.y };
    }
    // False when the arrow was deleted meanwhile: the interaction simply ends.
    asStep(u, () => setConnectorEndpoint(d, cur.id, end, next));
  };

  const handle = (end: End, p: Point) => (
    <div
      key={end}
      role="button"
      tabIndex={-1}
      aria-label={end === 'from' ? 'Arrow start' : 'Arrow end'}
      className="connector-handle"
      data-testid={`connector-handle-${end}`}
      data-end={end}
      style={{ left: p.x, top: p.y, '--zoom': zoom, '--dot-radius': `${CONNECTOR_DOT_RADIUS_PX + 1}px` } as CSSProperties}
      onPointerDown={(e) => beginHandleDrag(e, end)}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
  const handles =
    selected && props.editable !== false ? (
      <div className="connector-handles" data-connector-id={c.id}>
        {handle('from', from)}
        {handle('to', to)}
      </div>
    ) : null;

  return (
    <div
      className={`connector-object${selected ? ' connector-object--selected' : ''}`}
      role="group"
      aria-roledescription="arrow"
      aria-label={props.label ?? 'Arrow'}
      data-object-id={c.id}
      data-connector-id={c.id}
      data-selected={selected}
      data-from={`${from.x},${from.y}`}
      data-to={`${to.x},${to.y}`}
      tabIndex={0}
      style={{ zIndex: props.stackIndex }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !selected) props.onSelect?.();
      }}
    >
      <svg
        className="connector-object__svg"
        style={{ left: box.x, top: box.y }}
        width={box.width}
        height={box.height}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        aria-hidden="true"
      >
        <line
          x1={from.x}
          y1={from.y}
          x2={head.base.x}
          y2={head.base.y}
          stroke={colour}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
          pointerEvents="none"
        />
        {head.points && <polygon points={head.points} fill={colour} pointerEvents="none" />}
        <line
          className="connector-object__hit"
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="transparent"
          strokeWidth={2 * tolerance}
          strokeLinecap="round"
          onPointerDown={onLinePointerDown}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      </svg>
      {handles && (overlay ? createPortal(handles, overlay) : handles)}
    </div>
  );
}

/** A short spoken name for an arrow: its kind and the objects it joins. */
function describeEnd(e: Endpoint, objects: readonly ObjectSnapshot[]): string | null {
  if (e.kind !== 'attached') return null;
  const o = objects.find((x) => x.id === e.objectId) as (ObjectSnapshot & { label?: string; text?: string }) | undefined;
  if (!o) return null;
  return (o.label ?? o.text ?? '') || o.type;
}

function ConnectorAdapter(props: ObjectProps) {
  const { object, doc, zoom, selected, editable } = props;
  const board = useContext(BoardContext);
  const rects = useMemo(() => attachableRects(board.objects), [board.objects]);
  if (!isConnector(object)) return null;
  const fromName = describeEnd(object.from, board.objects);
  const toName = describeEnd(object.to, board.objects);
  const label = `Arrow${fromName ? ` from ${fromName}` : ''}${toName ? ` to ${toName}` : ''}`;
  return (
    <ConnectorObject
      connector={object}
      rects={rects}
      doc={doc}
      selected={selected}
      zoom={zoom}
      editable={editable}
      stackIndex={props.stackIndex}
      label={label}
      onPointerDown={(e) => props.onObjectPointerDown(e, object.id)}
      onSelect={() => props.onSelect(object.id)}
    />
  );
}

/** The registry's component for arrows. */
export const ConnectorObjectView = memo(ConnectorAdapter);
