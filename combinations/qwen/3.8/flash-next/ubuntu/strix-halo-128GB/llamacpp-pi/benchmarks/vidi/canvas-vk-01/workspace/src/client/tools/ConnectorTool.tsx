import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import type { BoardSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor, SIDES, type Side } from '../../shared/geometry/connector-geometry';
import type { Point, Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { clientToWorld } from '../canvas/viewportPoint';
import { useBoardDoc } from '../board/useBoardDoc';
import { useIdentity } from '../board/useIdentity';
import { useUndoController } from '../board/UndoContext';
import { getObjectType } from '../objects/registry';

/**
 * The object an arrow would attach to under a client point: the topmost object
 * whose hit test matches. Connectors are skipped — an arrow attaches to shapes
 * and notes, never to another arrow.
 */
function attachableAt(
  snapshot: readonly BoardSnapshot[],
  camera: Camera,
  client: Point,
  excludeId: string | null,
): string | null {
  const world = clientToWorld(camera, client);
  for (let i = snapshot.length - 1; i >= 0; i -= 1) {
    const obj = snapshot[i];
    if (obj === undefined || obj.id === excludeId || obj.type === 'connector') continue;
    const spec = getObjectType(obj.type);
    if (spec !== undefined && spec.hitTest(obj, world, camera.zoom)) return obj.id;
  }
  return null;
}

const findObject = (
  snapshot: readonly BoardSnapshot[],
  id: string | null,
): BoardSnapshot | undefined =>
  id === null ? undefined : snapshot.find((obj) => obj.id === id);

/** The four side-midpoint dots of one object, in screen coordinates. */
function dotsOf(rect: Rect, camera: Camera): Array<{ side: Side; x: number; y: number }> {
  const anchorScreen = (side: Side): Point => {
    const world = sideAnchor(rect, side);
    return worldToScreen(camera, world);
  };
  return SIDES.map((side) => ({ side, ...anchorScreen(side) }));
}

interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
  startId: string | null;
}

export interface ConnectorToolProps {
  camera: Camera;
  /** The board, to hit-test what the arrow starts from and lands on. */
  snapshot: readonly BoardSnapshot[];
  /** An arrow was created: select it and return to Select. */
  onCreated(id: string): void;
}

/**
 * The Connector tool (story 10). Hovering an object shows the four connection
 * dots on its sides (`connector.hover_points`); dragging from an object or from
 * empty space draws a preview arrow, highlighting the target object's dot it
 * would attach to. Releasing over an object attaches that end, over empty space
 * fixes it at the point (`connector.create_attached`, `connector.create_free`).
 *
 * The two rules against accidental arrows — back on the starting object, or a
 * drag of a few pixels — are the model's, and a rejected creation simply leaves
 * the tool ready to try again.
 */
export function ConnectorTool({ camera, snapshot, onCreated }: ConnectorToolProps): JSX.Element {
  const { doc } = useBoardDoc();
  const identity = useIdentity();
  const undo = useUndoController();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const latestRef = useRef({ camera, snapshot });
  useEffect(() => {
    latestRef.current = { camera, snapshot };
  });

  const release = useCallback(
    (current: Drag, client: Point) => {
      const { camera: cam, snapshot: snap } = latestRef.current;
      const worldStart = clientToWorld(cam, { x: current.startX, y: current.startY });
      const worldEnd = clientToWorld(cam, client);
      if (!Number.isFinite(worldStart.x) || !Number.isFinite(worldEnd.x)) return;
      const targetId = attachableAt(snap, cam, client, null);
      const from: Endpoint =
        current.startId === null
          ? { kind: 'free', x: worldStart.x, y: worldStart.y }
          : { kind: 'attached', objectId: current.startId, fallback: worldStart };
      const to: Endpoint =
        targetId === null
          ? { kind: 'free', x: worldEnd.x, y: worldEnd.y }
          : { kind: 'attached', objectId: targetId, fallback: worldEnd };
      undo?.boundary();
      const id = createConnector(doc, from, to, identity.id);
      undo?.boundary();
      if (id !== null) onCreated(id);
    },
    [doc, identity.id, onCreated, undo],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const { cam, snap } = { cam: latestRef.current.camera, snap: latestRef.current.snapshot };
    setDrag({
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startId: attachableAt(snap, cam, { x: event.clientX, y: event.clientY }, null),
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const client = { x: event.clientX, y: event.clientY };
    if (drag === null) {
      const id = attachableAt(latestRef.current.snapshot, latestRef.current.camera, client, null);
      setHoverId((previous) => (previous === id ? previous : id));
      return;
    }
    setDrag({ ...drag, x: event.clientX, y: event.clientY });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag;
    setDrag(null);
    if (current === null) return;
    event.stopPropagation();
    release(current, { x: event.clientX, y: event.clientY });
  };

  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const startObject = findObject(snapshot, drag?.startId ?? null);
  const targetId =
    drag === null
      ? null
      : attachableAt(snapshot, camera, { x: drag.x, y: drag.y }, drag.startId);
  const targetObject = findObject(snapshot, targetId);
  const hoverObject = drag === null ? findObject(snapshot, hoverId) : undefined;
  const highlightedSide =
    drag !== null && targetObject !== undefined
      ? nearestSide(objectBounds(targetObject), clientToWorld(camera, { x: drag.startX, y: drag.startY }))
      : null;

  const renderDots = (object: BoardSnapshot | undefined, highlight: Side | null) => {
    if (object === undefined) return null;
    return dotsOf(objectBounds(object), camera).map((dot) => (
      <div
        key={`${object.id}-${dot.side}`}
        data-testid="connector-dot"
        data-side={dot.side}
        data-object={object.id}
        data-highlighted={highlight === dot.side ? 'true' : undefined}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: `${dot.x - CONNECTOR_DOT_RADIUS_PX}px`,
          top: `${dot.y - CONNECTOR_DOT_RADIUS_PX}px`,
          width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
          height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
          borderRadius: '50%',
          boxSizing: 'border-box',
          background: highlight === dot.side ? '#2563EB' : '#ffffff',
          border: `1px solid ${highlight === dot.side ? '#1D4ED8' : '#2563EB'}`,
          transform: highlight === dot.side ? 'scale(1.4)' : undefined,
          pointerEvents: 'none',
        }}
      />
    ));
  };

  return (
    <div
      data-testid="connector-tool-layer"
      className="tool-layer"
      style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {drag === null ? renderDots(hoverObject, null) : renderDots(targetObject, highlightedSide)}
      {drag !== null && (
        <svg
          data-testid="connector-preview"
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
          aria-hidden="true"
        >
          <line
            x1={drag.startX}
            y1={drag.startY}
            x2={drag.x}
            y2={drag.y}
            stroke="#2563EB"
            strokeWidth={2 / zoom}
            strokeDasharray="6 4"
          />
        </svg>
      )}
      {drag !== null && startObject !== undefined && renderDots(startObject, null)}
    </div>
  );
}
