import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_COLOR,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_STROKE_WIDTH_WORLD,
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
import { createConnector } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { SIDES } from '../objects/ConnectorObject';
import { attachableAt } from '../objects/objectTypes';

const PRIMARY_BUTTON = 0;

export interface ConnectorToolProps {
  camera: Camera;
  /** The board's objects, bottom to top. */
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  /** Recorded as `createdBy`. */
  createdBy: string;
  /** Selects the new arrow and returns to Select (tools.return_to_select). */
  onCreated(id: string): void;
  /** Runs the creation as one undo step (story 8); default: run it as is. */
  step?<T>(action: () => T): T;
}

interface Drag {
  pointerId: number;
  /** World point pressed. */
  start: Point;
  /** The object pressed on, if any (the arrow's start). */
  startId: string | undefined;
  /** Current world pointer position. */
  current: Point;
}

const run = <T,>(action: () => T): T => action();

function localPoint(el: Element, e: { clientX: number; clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * The Connector tool (story 10): a transparent layer over the board that owns every press while
 * the tool is active. The object under the pointer shows its four side-midpoint dots
 * (connector.hover_points). A drag from an object (or empty space) previews the arrow; over
 * another object that object's dot the arrow will attach to is highlighted. Release over an
 * object attaches the end (connector.create_attached), over empty space leaves it free at that
 * point (connector.create_free). Released on the start object, or after moving less than
 * CONNECTOR_MIN_LENGTH_WORLD, nothing is created and the tool stays (connector.no_accidental).
 */
export function ConnectorTool({ camera, snapshot, doc, createdBy, onCreated, step = run }: ConnectorToolProps) {
  const [hover, setHover] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const propsRef = useRef({ camera, snapshot });
  propsRef.current = { camera, snapshot };

  const worldOf = (el: Element, e: { clientX: number; clientY: number }) =>
    screenToWorld(propsRef.current.camera, localPoint(el, e));

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  /** The arrow the current drag would create, as drawn: start and end points and the target. */
  const plan = (d: Drag, objects: readonly ObjectSnapshot[]) => {
    const startObj = d.startId === undefined ? undefined : objects.find((o) => o.id === d.startId);
    const startRect = startObj ? objectBounds(startObj) : undefined;
    const target = attachableAt(objects, d.current, d.startId);
    const targetRect = target ? objectBounds(target) : undefined;
    const startAim = startRect ? rectCentre(startRect) : d.start;
    const endAim = targetRect ? rectCentre(targetRect) : d.current;
    const from = startRect ? attachedAnchor(startRect, endAim) : d.start;
    const side: Side | undefined = targetRect ? nearestSide(targetRect, startAim) : undefined;
    const to = targetRect && side ? sideAnchor(targetRect, side) : d.current;
    const overStart = startObj !== undefined && attachableAt(objects, d.current)?.id === startObj.id;
    return { startRect, target, targetRect, side, from, to, overStart };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || dragRef.current) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // The release still arrives without capture.
    }
    const start = worldOf(e.currentTarget, e);
    const startObj = attachableAt(propsRef.current.snapshot, start);
    updateDrag({ pointerId: e.pointerId, start, startId: startObj?.id, current: start });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = worldOf(e.currentTarget, e);
    setHover(p);
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) updateDrag({ ...d, current: p });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    updateDrag(null);
    const current = worldOf(e.currentTarget, e);
    const objects = propsRef.current.snapshot;
    const final = { ...d, current };
    // Too short a drag, or released on the object it started from: no arrow (tool stays).
    if (Math.hypot(current.x - d.start.x, current.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const p = plan(final, objects);
    if (p.overStart) return;
    const from: Endpoint =
      d.startId !== undefined
        ? { kind: 'attached', objectId: d.startId, fallback: p.from }
        : { kind: 'free', ...d.start };
    const to: Endpoint = p.target
      ? { kind: 'attached', objectId: p.target.id, fallback: p.to }
      : { kind: 'free', x: current.x, y: current.y };
    const id = step(() => createConnector(doc, from, to, createdBy));
    if (id) onCreated(id);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) updateDrag(null);
  };

  const toScreen = (p: Point) => worldToScreen(camera, p);

  const dots = (rect: Rect, lit: Side | undefined) =>
    SIDES.map((side) => {
      const p = toScreen(sideAnchor(rect, side));
      const highlighted = side === lit;
      return (
        <circle
          key={side}
          className={`connection-dot${highlighted ? ' connection-dot--highlighted' : ''}`}
          data-testid="connection-dot"
          data-side={side}
          data-highlighted={highlighted ? 'true' : 'false'}
          cx={p.x}
          cy={p.y}
          r={CONNECTOR_DOT_RADIUS_PX}
        />
      );
    });

  let content = null;
  if (drag) {
    const p = plan(drag, snapshot);
    const a = toScreen(p.from);
    const b = toScreen(p.to);
    content = (
      <>
        <line
          className="connector-tool__preview"
          data-testid="connector-preview"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={CONNECTOR_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * camera.zoom}
        />
        {p.targetRect && dots(p.targetRect, p.side)}
      </>
    );
  } else if (hover) {
    const obj = attachableAt(snapshot, hover);
    if (obj) content = dots(objectBounds(obj), undefined);
  }

  return (
    <div
      className="tool-layer tool-layer--connector"
      data-testid="connector-tool"
      data-hover-id={!drag && hover ? (attachableAt(snapshot, hover)?.id ?? '') : ''}
      data-target-id={drag ? (plan(drag, snapshot).target?.id ?? '') : ''}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onPointerLeave={() => {
        if (!dragRef.current) setHover(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="tool-layer__svg" aria-hidden="true" focusable="false">
        {content}
      </svg>
    </div>
  );
}
