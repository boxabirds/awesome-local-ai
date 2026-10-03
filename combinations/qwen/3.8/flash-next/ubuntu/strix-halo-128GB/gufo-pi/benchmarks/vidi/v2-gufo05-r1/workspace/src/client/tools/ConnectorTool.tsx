/**
 * The Connector tool's pointer (`connector.tool`): drag from one thing to another.
 *
 * While armed, every connectable object on the board shows a dot on each of its four sides.
 * Pressing a dot starts an arrow from that object; releasing over a *different* object
 * attaches the other end to it and creates the arrow. Releasing over empty space, or over
 * the object the arrow started from, creates nothing (`connector.tool`) — the two things an
 * arrow can meaningfully join are objects, and a loose end dragged to nowhere is the same
 * refusal the model already makes in `connector.model`.
 *
 * Like the Shape tool this is a full-board sheet that claims every press, so the arrow is the
 * only thing a drag can do. The dots and the preview line are drawn in screen space from the
 * camera, and the drop target is decided in world space, where the objects actually are.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import type { Endpoint, Side } from '../../shared/geometry/connector-geometry';
import { sideAnchor } from '../../shared/geometry/connector-geometry';
import { SHAPE_TYPE } from '../../shared/objects/shape';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

export interface ConnectorToolProps {
  camera: Camera;
  /** The objects this build can draw; the connectable ones get dots. */
  objects: readonly ObjectSnapshot[];
  /** An arrow was drawn between two objects. */
  onCreate(from: Endpoint, to: Endpoint): void;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** Is this something an arrow may start from or end at? */
function connectable(object: ObjectSnapshot): boolean {
  return object.type === SHAPE_TYPE || object.type === 'sticky';
}

export function ConnectorTool({ camera, objects, onCreate }: ConnectorToolProps) {
  const [drag, setDrag] = useState<{ start: Point; end: Point; startId: string } | null>(null);
  const startRef = useRef<{ objectId: string; anchor: Point } | null>(null);

  const dots = objects.filter(connectable).flatMap((object) => {
    const rect = objectBounds(object);
    return SIDES.map((side) => {
      const anchor = sideAnchor(rect, side);
      const screen = worldToScreen(camera, anchor);
      return { objectId: object.id, side, anchor, screen };
    });
  });

  const beginDrag = useCallback(
    (dot: { objectId: string; anchor: Point }) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startRef.current = { objectId: dot.objectId, anchor: dot.anchor };
      setDrag({ start: { x: event.clientX, y: event.clientY }, end: { x: event.clientX, y: event.clientY }, startId: dot.objectId });
    },
    [],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setDrag((current) => (current ? { ...current, end: { x: event.clientX, y: event.clientY } } : current));
  }, []);

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      if (!drag || !start) {
        setDrag(null);
        return;
      }
      const world = screenToWorld(camera, { x: event.clientX, y: event.clientY });
      // What object, if any, is under the release point.
      let drop: ObjectSnapshot | null = null;
      for (const object of objects) {
        if (!connectable(object)) continue;
        const b = objectBounds(object);
        if (world.x >= b.x && world.x <= b.x + b.width && world.y >= b.y && world.y <= b.y + b.height) {
          drop = object;
          break;
        }
      }
      startRef.current = null;
      setDrag(null);
      // Only a different object makes an arrow: empty space, and the object itself, create
      // nothing (`connector.tool`).
      if (drop && drop.id !== start.objectId) {
        onCreate(
          { kind: 'attached', objectId: start.objectId, fallback: start.anchor },
          { kind: 'attached', objectId: drop.id, fallback: world },
        );
      }
    },
    [camera, drag, objects, onCreate],
  );

  return (
    <div
      className="tool-overlay tool-overlay--connector"
      data-testid="connector-tool"
      style={{ position: 'fixed', inset: 0, cursor: 'crosshair', pointerEvents: 'all', touchAction: 'none', zIndex: 1 }}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => {
        startRef.current = null;
        setDrag(null);
      }}
    >
      {drag ? (
        <svg style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <line x1={drag.start.x} y1={drag.start.y} x2={drag.end.x} y2={drag.end.y} stroke="#2563eb" strokeWidth={2} strokeDasharray="4 4" />
        </svg>
      ) : null}
      {dots.map((dot) => (
        <button
          key={`${dot.objectId}:${dot.side}`}
          type="button"
          className="connector-dot"
          data-testid="connector-dot"
          data-object-id={dot.objectId}
          data-side={dot.side}
          aria-label={`Connect from ${dot.side}`}
          style={{
            position: 'fixed',
            left: dot.screen.x,
            top: dot.screen.y,
            width: CONNECTOR_DOT_RADIUS_PX * 2,
            height: CONNECTOR_DOT_RADIUS_PX * 2,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: '2px solid #2563eb',
            background: '#fff',
            padding: 0,
            cursor: 'crosshair',
            pointerEvents: 'auto',
          }}
          onPointerDown={beginDrag(dot)}
        />
      ))}
    </div>
  );
}
