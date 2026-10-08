/**
 * Connector tool (story 10, connector.tool_ui): a full-viewport layer that
 * owns all pointer input while the Connector tool is active.
 *
 * - Hovering over a board object shows four connection dots (side
 *   midpoints, CONNECTOR_DOT_RADIUS_PX screen pixels).
 * - Dragging from an object (or empty space, which starts a free end)
 *   previews a dashed arrow; over a target object the dot on the side the
 *   arrow will attach to (nearest the drag start) is highlighted.
 * - Release: over another object the arrow attaches to it (the model
 *   stores the side anchor as fallback); over empty space the end is free
 *   at the release point. Rejected creations (same object, below
 *   CONNECTOR_MIN_LENGTH_WORLD) create nothing and the tool stays active
 *   (the model returns null). A successful create returns to Select via
 *   `onCreated` (tools.return_to_select).
 */
import {
  type JSX,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_INK_COLOR,
} from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  nearestSide,
  sideAnchor,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { CLIENT_ID } from '../client-id';

export interface ConnectorToolProps {
  doc: Y.Doc;
  camera: Camera;
  /** The live object snapshot (targets for hover / attach). */
  snapshot: readonly ObjectSnapshot[];
  /** tools.return_to_select: select the new id and switch to Select. */
  onCreated(id: string): void;
  /** Closes the undo capture window around the create (undo.boundaries). */
  onBoundary(): void;
}

interface Drag {
  pointerId: number;
  startWorld: Point;
  startEndpoint: Endpoint;
  startObjectId: string | null;
  current: Point;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The topmost non-connector object (by z) whose box contains `p`. */
function objectAt(
  snapshot: readonly ObjectSnapshot[],
  p: Point,
  excludeId?: string,
): { id: string; rect: Rect } | null {
  let best: { id: string; z: number; rect: Rect } | null = null;
  for (const o of snapshot) {
    if (o.type === 'connector') {
      continue;
    }
    if (excludeId !== undefined && o.id === excludeId) {
      continue;
    }
    const rect = objectBounds(o);
    if (
      p.x < rect.x ||
      p.x >= rect.x + rect.width ||
      p.y < rect.y ||
      p.y >= rect.y + rect.height
    ) {
      continue;
    }
    if (best === null || o.z >= best.z) {
      best = { id: o.id, z: o.z, rect };
    }
  }
  return best;
}

export function ConnectorTool({
  doc,
  camera,
  snapshot,
  onCreated,
  onBoundary,
}: ConnectorToolProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: Rect } | null>(null);
  const [drag, setDrag] = useState<Omit<Drag, 'pointerId' | 'startEndpoint'> | null>(null);

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = layerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return screenToWorld(camera, { x: clientX - rect.left, y: clientY - rect.top });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    const el = layerRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
    const world = toWorld(e.clientX, e.clientY);
    const target = objectAt(snapshot, world);
    const startEndpoint: Endpoint =
      target !== null
        ? {
            kind: 'attached',
            objectId: target.id,
            fallback: sideAnchor(target.rect, nearestSide(target.rect, world)),
          }
        : { kind: 'free', x: world.x, y: world.y };
    const d: Drag = {
      pointerId: e.pointerId,
      startWorld: world,
      startEndpoint,
      startObjectId: target?.id ?? null,
      current: world,
    };
    dragRef.current = d;
    setDrag({ startWorld: d.startWorld, startObjectId: d.startObjectId, current: d.current });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const world = toWorld(e.clientX, e.clientY);
    const d = dragRef.current;
    if (d !== null && e.pointerId === d.pointerId) {
      d.current = world;
      setDrag({
        startWorld: d.startWorld,
        startObjectId: d.startObjectId,
        current: world,
      });
      setHover(null);
      return;
    }
    setHover(objectAt(snapshot, world));
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.pointerId) {
      return;
    }
    dragRef.current = null;
    setDrag(null);
    const world = toWorld(e.clientX, e.clientY);
    const target = objectAt(snapshot, world, d.startObjectId ?? undefined);
    const toEndpoint: Endpoint =
      target !== null
        ? {
            kind: 'attached',
            objectId: target.id,
            fallback: sideAnchor(target.rect, nearestSide(target.rect, d.startWorld)),
          }
        : { kind: 'free', x: world.x, y: world.y };
    onBoundary();
    const id = createConnector(doc, { from: d.startEndpoint, to: toEndpoint }, CLIENT_ID);
    onBoundary();
    if (id !== null) {
      onCreated(id);
    }
    // A rejected create (null) keeps the tool active; the hover dots resume
    // on the next move.
  };

  const onCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.pointerId) {
      return;
    }
    dragRef.current = null;
    setDrag(null); // pointercancel: nothing created
  };

  // --- screen-space rendering ------------------------------------------------
  const screen = (p: Point): Point => worldToScreen(camera, p);

  /** Four side dots for one object; `highlight` (a side) gets the filled dot. */
  const dots = (rect: Rect, highlight: Side | null, testid: string): JSX.Element => (
    <g data-testid={testid}>
      {SIDES.map((side) => {
        const s = screen(sideAnchor(rect, side));
        const active = side === highlight;
        return (
          <circle
            key={side}
            data-connector-dot={side}
            data-testid={`connector-dot-${side}`}
            data-highlighted={active ? 'true' : 'false'}
            cx={s.x}
            cy={s.y}
            r={CONNECTOR_DOT_RADIUS_PX}
            fill={active ? CONNECTOR_INK_COLOR : '#fff'}
            stroke={CONNECTOR_INK_COLOR}
            strokeWidth={1.5}
          />
        );
      })}
    </g>
  );

  let content: JSX.Element | null = null;
  if (drag !== null) {
    const target = objectAt(snapshot, drag.current, drag.startObjectId ?? undefined);
    const highlight =
      target !== null ? nearestSide(target.rect, drag.startWorld) : null;
    const a = screen(drag.startWorld);
    const b = screen(drag.current);
    content = (
      <>
        {target !== null && dots(target.rect, highlight, 'connector-target-dots')}
        <line
          data-testid="connector-drag-preview"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={CONNECTOR_INK_COLOR}
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        <circle
          data-testid="connector-drag-cursor"
          cx={b.x}
          cy={b.y}
          r={CONNECTOR_DOT_RADIUS_PX}
          fill={CONNECTOR_INK_COLOR}
        />
      </>
    );
  } else if (hover !== null) {
    content = dots(hover.rect, null, 'connector-hover-dots');
  }

  return (
    <div
      ref={layerRef}
      data-testid="connector-tool-layer"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 500,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={onCancel}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        aria-hidden="true"
      >
        {content}
      </svg>
    </div>
  );
}
