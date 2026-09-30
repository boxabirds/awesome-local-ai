// Connector tool (story 10): drag from an object (or empty space) to another object (or empty
// space) to draw an arrow. Hovering an object shows its four connection dots; while dragging,
// the dot the arrow will attach to is highlighted. Like the Shape tool it owns every press.
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import {
  SIDES,
  type Side,
  nearestSide,
  rectCenter,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import { type Endpoint, createConnector } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import { type Camera, screenToWorld, worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const PRIMARY_BUTTON = 0;

interface Hit {
  id: string;
  rect: Rect;
}

interface Dragging {
  pointerId: number;
  start: Point;
  from: Hit | null;
}

/** The topmost object an arrow can attach to (anything but an arrow) under `p`. */
export function attachableAt(snapshot: readonly ObjectSnapshot[], p: Point, zoom: number): Hit | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const o = snapshot[i];
    if (o.type === 'connector') continue;
    const spec = getObjectType(o.type);
    if (spec?.hitTest(o, p, zoom)) return { id: o.id, rect: { x: o.x, y: o.y, width: o.width, height: o.height } };
  }
  return null;
}

function localPoint(e: { clientX: number; clientY: number; currentTarget: Element }): Point {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  doc: Y.Doc;
  /** Identity stored as `createdBy`. */
  by: string;
}) {
  const { camera, snapshot } = props;
  const history = useUndoController();
  const [pointer, setPointer] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const draggingRef = useRef<Dragging | null>(null);
  const update = (d: Dragging | null) => {
    draggingRef.current = d;
    setDragging(d);
  };

  const hover = pointer ? attachableAt(snapshot, pointer, camera.zoom) : null;
  // While dragging, the start object is not a target.
  const target = dragging && hover?.id === dragging.from?.id ? null : hover;
  const startRef = (d: Dragging): Point => (d.from ? rectCenter(d.from.rect) : d.start);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = screenToWorld(camera, localPoint(e));
    setPointer(p);
    update({ pointerId: e.pointerId, start: p, from: attachableAt(snapshot, p, camera.zoom) });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    if (d && e.pointerId !== d.pointerId) return;
    setPointer(screenToWorld(camera, localPoint(e)));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    update(null);
    const end = screenToWorld(camera, localPoint(e));
    setPointer(end);
    // Too short a drag: nothing is created and the tool stays active.
    if (Math.hypot(end.x - d.start.x, end.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const to = attachableAt(snapshot, end, camera.zoom);
    // Released on the object it started from: nothing is created.
    if (to && to.id === d.from?.id) return;
    const toward = (h: Hit, other: Point) => sideAnchor(h.rect, nearestSide(h.rect, other));
    const toRef = to ? rectCenter(to.rect) : end;
    const from: Endpoint = d.from
      ? { kind: 'attached', objectId: d.from.id, fallback: toward(d.from, toRef) }
      : { kind: 'free', x: d.start.x, y: d.start.y };
    const toEnd: Endpoint = to
      ? { kind: 'attached', objectId: to.id, fallback: toward(to, startRef(d)) }
      : { kind: 'free', x: end.x, y: end.y };
    history?.boundary();
    const id = createConnector(props.doc, from, toEnd, props.by);
    history?.boundary();
    if (id) props.onCreated(id);
  };
  const onPointerCancel = () => update(null);

  // Connection dots on the object under the pointer; the one an arrow would attach to is highlighted.
  let dots = null;
  if (target) {
    const highlighted: Side | null = dragging ? nearestSide(target.rect, startRef(dragging)) : null;
    dots = SIDES.map((side) => {
      const p = worldToScreen(camera, sideAnchor(target.rect, side));
      return (
        <div
          key={side}
          className={side === highlighted ? 'connector-dot is-highlighted' : 'connector-dot'}
          data-testid="connector-dot"
          data-side={side}
          data-object-id-target={target.id}
          data-highlighted={side === highlighted}
          style={{
            left: p.x - CONNECTOR_DOT_RADIUS_PX,
            top: p.y - CONNECTOR_DOT_RADIUS_PX,
            width: CONNECTOR_DOT_RADIUS_PX * 2,
            height: CONNECTOR_DOT_RADIUS_PX * 2,
          }}
        />
      );
    });
  }

  // Preview of the arrow being drawn.
  let preview = null;
  if (dragging && pointer) {
    const endWorld = target ? sideAnchor(target.rect, nearestSide(target.rect, startRef(dragging))) : pointer;
    const startWorld = dragging.from
      ? sideAnchor(dragging.from.rect, nearestSide(dragging.from.rect, target ? rectCenter(target.rect) : pointer))
      : dragging.start;
    const a = worldToScreen(camera, startWorld);
    const b = worldToScreen(camera, endWorld);
    preview = (
      <svg className="connector-preview" data-testid="connector-preview" aria-hidden="true">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      </svg>
    );
  }

  return (
    <div
      className="tool-layer connector-tool"
      data-testid="connector-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onPointerLeave={() => {
        if (!draggingRef.current) setPointer(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview}
      {dots}
    </div>
  );
}
