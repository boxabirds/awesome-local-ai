import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { type ObjectSnapshot, objectBounds } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { type Side, SIDES, nearestSide, rectCentre, sideAnchor } from '../../shared/geometry/connector-geometry';
import { type Endpoint, createConnector } from '../../shared/objects/connector';
import type { UndoController } from '../board/undo';
import { type Camera, type Point, screenToWorld, worldToScreen } from '../canvas/camera';
import { attachableObjectAt } from '../objects/hitTest';

const PRIMARY_BUTTON = 0;

interface Drag {
  pointerId: number;
  /** Press point in world units. */
  start: Point;
  /** Object the drag started on (null: empty space, a free start). */
  fromId: string | null;
  current: Point;
}

/** The four side dots of `rect` in screen space; `highlight` marks the side the arrow will attach to. */
function Dots(props: { rect: Rect; camera: Camera; highlight?: Side; objectId: string }) {
  return (
    <>
      {SIDES.map((side) => {
        const p = worldToScreen(props.camera, sideAnchor(props.rect, side));
        const on = props.highlight === side;
        return (
          <circle
            key={side}
            className={on ? 'connector-dot is-highlighted' : 'connector-dot'}
            data-testid="connector-dot"
            data-side={side}
            data-object-id={props.objectId}
            data-highlighted={on ? 'true' : 'false'}
            cx={p.x}
            cy={p.y}
            r={on ? CONNECTOR_DOT_RADIUS_PX * 1.5 : CONNECTOR_DOT_RADIUS_PX}
          />
        );
      })}
    </>
  );
}

/**
 * Connector tool (connector.ui): a screen-space layer over the board. Hovering
 * an object shows dots at its four side midpoints; dragging from an object (or
 * empty space) to another object (or empty space) creates an arrow, and the
 * target's dot the arrow will attach to is highlighted. Releasing on the start
 * object, or after moving less than CONNECTOR_MIN_LENGTH_WORLD, creates nothing.
 */
export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  doc: Y.Doc;
  /** `createdBy` of new arrows. */
  createdBy: string;
  undo?: UndoController;
}): React.JSX.Element {
  const { camera, snapshot } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const worldAt = (e: { clientX: number; clientY: number }): Point => {
    const rect = ref.current?.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };
  const objectAt = (world: Point) => attachableObjectAt(snapshot, world, camera.zoom);

  /** Start object, target and both end points for a drag from `d` to `current` (world units). */
  const planArrow = (d: Drag, current: Point) => {
    const from = d.fromId ? (snapshot.find((o) => o.id === d.fromId) ?? null) : null;
    const hit = objectAt(current);
    const target = hit && hit.id !== d.fromId ? hit : null;
    const fromRect = from ? objectBounds(from) : null;
    const targetRect = target ? objectBounds(target) : null;
    const fromRef = fromRect ? rectCentre(fromRect) : d.start;
    const toRef = targetRect ? rectCentre(targetRect) : current;
    const side = targetRect ? nearestSide(targetRect, fromRef) : null;
    return {
      from,
      fromRect,
      target,
      targetRect,
      side,
      onStart: hit !== null && hit.id === d.fromId,
      fromPoint: fromRect ? sideAnchor(fromRect, nearestSide(fromRect, toRef)) : d.start,
      toPoint: targetRect && side ? sideAnchor(targetRect, side) : current,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || dragRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    const world = worldAt(e);
    update({ pointerId: e.pointerId, start: world, fromId: objectAt(world)?.id ?? null, current: world });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const world = worldAt(e);
    const d = dragRef.current;
    if (!d) {
      setHover(world);
      return;
    }
    if (d.pointerId === e.pointerId) update({ ...d, current: world });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    update(null);
    const end = worldAt(e);
    setHover(end);
    if (Math.hypot(end.x - d.start.x, end.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const plan = planArrow(d, end);
    // Released on the object it started from: no arrow.
    if (plan.onStart) return;
    // Fallbacks are where each end attaches now (drawn only if its object vanishes concurrently).
    const from: Endpoint = plan.from
      ? { kind: 'attached', objectId: plan.from.id, fallback: plan.fromPoint }
      : { kind: 'free', x: d.start.x, y: d.start.y };
    const to: Endpoint = plan.target
      ? { kind: 'attached', objectId: plan.target.id, fallback: plan.toPoint }
      : { kind: 'free', x: end.x, y: end.y };
    props.undo?.boundary();
    const id = createConnector(props.doc, from, to, props.createdBy);
    props.undo?.boundary();
    // Rejected (too short, same object): the tool stays active.
    if (id !== null) props.onCreated(id);
  };

  const cancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) update(null);
  };

  // What to show: the hovered object's dots, or while dragging the start
  // object's anchor, a preview line and the target's dots with its attach side highlighted.
  let dots: React.JSX.Element | null = null;
  let preview: { from: Point; to: Point } | null = null;
  if (drag) {
    const plan = planArrow(drag, drag.current);
    preview = { from: worldToScreen(camera, plan.fromPoint), to: worldToScreen(camera, plan.toPoint) };
    if (plan.target && plan.targetRect && plan.side) {
      dots = <Dots rect={plan.targetRect} camera={camera} objectId={plan.target.id} highlight={plan.side} />;
    } else if (plan.from && plan.fromRect) {
      dots = <Dots rect={plan.fromRect} camera={camera} objectId={plan.from.id} />;
    }
  } else if (hover) {
    const hovered = objectAt(hover);
    if (hovered) dots = <Dots rect={objectBounds(hovered)} camera={camera} objectId={hovered.id} />;
  }

  return (
    <div
      ref={ref}
      className="tool-layer connector-tool"
      data-testid="connector-tool"
      data-state={drag ? 'dragging' : 'hovering'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerLeave={() => {
        if (!dragRef.current) setHover(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="connector-tool-svg" aria-hidden="true">
        {preview && (
          <line
            className="connector-preview"
            data-testid="connector-preview"
            x1={preview.from.x}
            y1={preview.from.y}
            x2={preview.to.x}
            y2={preview.to.y}
          />
        )}
        {dots}
      </svg>
    </div>
  );
}
