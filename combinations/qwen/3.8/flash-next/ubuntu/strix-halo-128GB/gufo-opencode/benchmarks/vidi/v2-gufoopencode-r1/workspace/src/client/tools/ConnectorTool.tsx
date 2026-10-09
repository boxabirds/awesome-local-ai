import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, JSX } from 'react';
import type { Point, Rect } from '../../shared/geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import type { EndpointInput } from '../../shared/objects/connector';

export interface ConnectorToolProps {
  zoom: number;
  screenToWorld(clientX: number, clientY: number): Point;
  worldToScreen(world: Point): Point;
  hitTestAtWorld(world: Point, excludeId?: string): string | null;
  getRect(id: string): Rect | null;
  onCreateConnector(from: EndpointInput, to: EndpointInput): void;
  onCancel?(): void;
}

interface DragState {
  fromId: string;
  fromCenter: Point;
  currentWorld: Point;
  targetId: string | null;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

function centreOf(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// Story 10 Connector tool (design connector.tool): hovering an object shows its
// four side dots; a drag from one object to another creates an attached arrow,
// to empty space a free end, and starting off an object or releasing on the
// same object creates nothing (tool stays).
export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pointerId = useRef<number | null>(null);
  const z = props.zoom > 0 ? props.zoom : 1;

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const world = props.screenToWorld(event.clientX, event.clientY);
    if (drag !== null) {
      const targetId = props.hitTestAtWorld(world, drag.fromId);
      setDrag({ ...drag, currentWorld: world, targetId });
      return;
    }
    setHoverId(props.hitTestAtWorld(world));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const world = props.screenToWorld(event.clientX, event.clientY);
    const id = props.hitTestAtWorld(world);
    if (id === null) return;
    const rect = props.getRect(id);
    if (rect === null) return;
    pointerId.current = event.pointerId;
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // jsdom and older browsers: window-level pointer events still drive the drag.
    }
    setDrag({ fromId: id, fromCenter: centreOf(rect), currentWorld: world, targetId: null });
  };

  const finish = (cancelled: boolean) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    pointerId.current = null;
    if (cancelled) {
      setDrag(null);
      props.onCancel?.();
      return;
    }
    const world = props.screenToWorld(event.clientX, event.clientY);
    const targetId = props.hitTestAtWorld(world, drag.fromId);
    const from: EndpointInput = { kind: 'attached', objectId: drag.fromId };
    if (targetId !== null && targetId !== drag.fromId) {
      props.onCreateConnector(from, { kind: 'attached', objectId: targetId });
    } else if (targetId === null) {
      props.onCreateConnector(from, { kind: 'free', x: world.x, y: world.y });
    }
    setDrag(null);
  };

  const renderDots = (id: string, highlight: Side | null): JSX.Element | null => {
    const rect = props.getRect(id);
    if (rect === null) return null;
    return (
      <g data-testid={`connector-dots-${id}`}>
        {SIDES.map((side) => {
          const anchor = sideAnchor(rect, side);
          const screen = props.worldToScreen(anchor);
          return (
            <circle
              key={side}
              data-testid={`connector-dot-${side}`}
              data-object={id}
              data-side={side}
              data-highlighted={highlight === side}
              cx={screen.x}
              cy={screen.y}
              r={CONNECTOR_DOT_RADIUS_PX}
              fill={highlight === side ? '#1E88E5' : '#ffffff'}
              stroke="#1E88E5"
              strokeWidth={1 / z}
            />
          );
        })}
      </g>
    );
  };

  // Screen-space SVG overlay (not inside the scaled world layer): dots are a
  // constant CONNECTOR_DOT_RADIUS_PX on screen, so radius is in screen px here.
  const fromRect = drag !== null ? props.getRect(drag.fromId) : null;
  const fromHighlight =
    fromRect !== null ? nearestSide(fromRect, drag !== null ? drag.currentWorld : { x: 0, y: 0 }) : null;
  const targetRect = drag !== null && drag.targetId !== null ? props.getRect(drag.targetId) : null;
  const targetHighlight =
    targetRect !== null && drag !== null ? nearestSide(targetRect, drag.fromCenter) : null;

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 45 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish(false)}
      onPointerCancel={finish(true)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
        {drag === null && hoverId !== null ? renderDots(hoverId, null) : null}
        {drag !== null ? renderDots(drag.fromId, fromHighlight) : null}
        {drag !== null && drag.targetId !== null ? renderDots(drag.targetId, targetHighlight) : null}
        {drag !== null ? (
          <line
            data-testid="connector-preview"
            x1={props.worldToScreen(centreOf(fromRect ?? { x: 0, y: 0, width: 0, height: 0 })).x}
            y1={props.worldToScreen(centreOf(fromRect ?? { x: 0, y: 0, width: 0, height: 0 })).y}
            x2={props.worldToScreen(drag.currentWorld).x}
            y2={props.worldToScreen(drag.currentWorld).y}
            stroke="#1E88E5"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        ) : null}
      </svg>
    </div>
  );
}
