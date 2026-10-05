/**
 * Connector objects: an arrow between two things (story 10, `connector.*`).
 *
 * An arrow stores no geometry of its own. Each end is either a point or a reference to
 * an object, and every render recomputes where it attaches from the target's *current*
 * rectangle (`resolveEndpoints`, done once per board read in `board-model`). That is
 * what makes "the arrow follows the shape" true for the person dragging and for
 * everyone watching: nobody holds a position that could go out of date, so a move —
 * local or remote — repaints the arrow by itself, and a target that has gone leaves its
 * end parked at the last anchor instead of snapping to the origin.
 *
 * Everything is drawn in world units like the rest of the world layer, with two
 * exceptions that are deliberately measured in *screen* pixels: the wide invisible
 * stroke you click (`CONNECTOR_HIT_TOLERANCE_PX`) and the handles you drag
 * (`CONNECTOR_HANDLE_RADIUS_PX`). A target you aim at with a cursor stays the size of
 * a cursor's target at every zoom, so those are divided by the zoom.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import { ENDS, nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Camera, Point } from '../canvas/camera';
import {
  attachTargetAt,
  attachTargets,
  setConnectorEndpoint,
  type ConnectorSnap,
  type Endpoint,
} from '../../shared/objects/connector';
import type { ObjectTypeSpec } from './registry';

/** Which end of an arrow a handle belongs to. */
export type ConnectorEnd = 'from' | 'to';

const INK = SHAPE_STROKE_COLORS.dark;

/** Room around the line's box for the arrowhead, the caps and the handles. */
const PAD_WORLD = CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_STROKE_WIDTH_WORLD * 2;

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  doc: Y.Doc;
  camera: Camera;
  selected: boolean;
  onObjectPointerDown(event: ReactPointerEvent | PointerEvent, snapshot: ObjectSnapshot): void;
  /** Open and close one undo step around the end being dragged. */
  onUndoBoundary?(): void;
}

export function ConnectorObject(props: ConnectorObjectProps) {
  const { connector, doc, camera, selected, onObjectPointerDown, onUndoBoundary } = props;
  const zoom = camera.zoom;
  const ends = connector.ends;
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // While an end is being dragged the line follows the cursor and nothing is written:
  // an abandoned gesture must leave no trace on the board.
  const [drag, setDrag] = useState<{ end: ConnectorEnd; at: Point } | null>(null);
  const live = useRef({ connector, doc, ends, onUndoBoundary });
  live.current = { connector, doc, ends, onUndoBoundary };

  const bounds = objectBounds(connector);
  const box = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  const left = box.x - PAD_WORLD;
  const top = box.y - PAD_WORLD;
  const width = Math.max(box.width + PAD_WORLD * 2, 1);
  const height = Math.max(box.height + PAD_WORLD * 2, 1);
  /** A world point as a position inside this SVG. */
  const at = (point: Point): Point => ({ x: point.x - left, y: point.y - top });

  const from = drag?.end === 'from' ? drag.at : ends.from;
  const to = drag?.end === 'to' ? drag.at : ends.to;
  const p0 = at(from);
  const p1 = at(to);
  const path = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;

  const endPointerDown = useCallback(
    (end: ConnectorEnd) => (event: PointerEvent | ReactPointerEvent): void => {
      event.stopPropagation();
      // The gesture is resolved against the zoom it started on: a pan or a zoom of
      // the camera mid-drag is not followed, which is the same bargain every other
      // gesture on this board makes.
      const camera = props.camera;
      /**
       * The world point under the cursor.
       *
       * The arrow is drawn in world units inside the viewport's scaled layer, so the
       * reference frame is the viewport and the arithmetic is the camera's own — not
       * this object's (very thin) box, which would make the aim depend on where the
       * arrow happens to point.
       */
      const worldOf = (e: PointerEvent): Point | null => {
        const el = surfaceRef.current;
        if (!el) return null;
        const rect = (el.closest('.board-viewport') ?? el).getBoundingClientRect();
        return {
          x: (e.clientX - rect.left) / camera.zoom + camera.x,
          y: (e.clientY - rect.top) / camera.zoom + camera.y,
        };
      };
      const move = (e: PointerEvent): void => {
        const point = worldOf(e);
        if (point) setDrag({ end, at: point });
      };
      const up = (e: PointerEvent): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const here = live.current;
        const point = worldOf(e);
        setDrag(null);
        // No frame to resolve against (the object unmounted mid-gesture): the handle
        // goes back where it was and nothing is written.
        if (!point) return;
        // Where does this end belong? On an object, parked at the middle of the side
        // facing the other end; on nothing at all, at the point it was dropped.
        const targetId = attachTargetAt(here.doc, point, here.connector.id);
        const target = targetId === null ? undefined : attachTargets(here.doc).find((t) => t.id === targetId);
        const opposite = end === 'from' ? here.ends.to : here.ends.from;
        const endpoint: Endpoint = target
          ? {
              kind: 'attached',
              objectId: target.id,
              fallback: sideAnchor(target.rect, nearestSide(target.rect, opposite)),
            }
          : { kind: 'free', x: point.x, y: point.y };
        // One drag of one end is one undo step, whether it attached or loosed.
        here.onUndoBoundary?.();
        setConnectorEndpoint(here.doc, here.connector.id, end, endpoint);
        here.onUndoBoundary?.();
      };
      const start = 'nativeEvent' in event ? event.nativeEvent : event;
      const atStart = worldOf(start);
      if (atStart) setDrag({ end, at: atStart });
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    // The box moves when the arrow moves, so the conversion has to be rebuilt with it.
    [left, top, props.camera],
  );

  // The dragged end shows where it would land: the dot on the side it would pick, so
  // the attachment is visible before the button comes up.
  const hoverTargetId = drag ? attachTargetAt(doc, drag.at, connector.id) : null;
  const hoverRect =
    hoverTargetId === null ? undefined : attachTargets(doc).find((t) => t.id === hoverTargetId)?.rect;
  const otherEnd = drag ? (drag.end === 'from' ? ends.to : ends.from) : null;
  const hoverDot =
    hoverRect && otherEnd ? at(sideAnchor(hoverRect, nearestSide(hoverRect, otherEnd))) : null;

  return (
    <div
      ref={surfaceRef}
      className="board-object connector-object"
      data-object-id={connector.id}
      data-object-type="connector"
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        // Only the line itself is a target: the padded box around it belongs to
        // whatever is underneath, including the board's own pan and marquee.
        pointerEvents: 'none',
      }}
    >
      <svg
        className="connector-svg"
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        {/* What a click lands on: the same path, a transparent stroke wide enough to
            be aimed at. */}
        <path
          d={path}
          data-object-body=""
          data-testid={`connector-hit-${connector.id}`}
          fill="none"
          stroke="rgba(0,0,0,0.001)"
          strokeWidth={(CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom}
          style={{ pointerEvents: 'stroke', cursor: 'default' }}
          onPointerDown={(event) => onObjectPointerDown(event, connector)}
        />
        <path
          data-testid={`connector-line-${connector.id}`}
          d={path}
          fill="none"
          stroke={INK}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
        <ArrowHead from={p0} to={p1} size={CONNECTOR_ARROWHEAD_SIZE_WORLD} color={INK} />
        {hoverDot ? (
          <circle
            data-testid={`connector-target-${connector.id}`}
            cx={hoverDot.x}
            cy={hoverDot.y}
            r={CONNECTOR_DOT_RADIUS_PX / zoom}
            fill={INK}
            style={{ pointerEvents: 'none' }}
          />
        ) : null}
        {selected
          ? ENDS.map((end) => (
              <circle
                key={end}
                data-endpoint={end}
                data-testid={`connector-handle-${end}`}
                cx={(end === 'from' ? p0 : p1).x}
                cy={(end === 'from' ? p0 : p1).y}
                r={CONNECTOR_HANDLE_RADIUS_PX / zoom}
                fill="#ffffff"
                stroke={INK}
                strokeWidth={1 / zoom}
                style={{ pointerEvents: 'all', cursor: 'grab' }}
                onPointerDown={endPointerDown(end)}
              />
            ))
          : null}
      </svg>
    </div>
  );
}

/**
 * A filled triangle at the head end: the point sits exactly at the arrow's end, the
 * back corners are `size` further along the line and `size / 2` to either side of it.
 */
export function ArrowHead(props: { from: Point; to: Point; size: number; color: string }) {
  const { from, to, size, color } = props;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // Two ends in the same place have no direction, and a head pointing along +x would
  // be a story about where the arrow was going that the document does not tell.
  if (length <= 1e-9) return null;
  const ux = dx / length;
  const uy = dy / length;
  const back = { x: to.x - ux * size, y: to.y - uy * size };
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  const points = [`${to.x},${to.y}`, `${back.x + px},${back.y + py}`, `${back.x - px},${back.y - py}`].join(' ');
  return (
    <polygon data-testid="connector-arrowhead" points={points} fill={color} stroke={color} strokeWidth={0} style={{ pointerEvents: 'none' }} />
  );
}

/**
 * An arrow is picked by its distance from the line. The tolerance is given in screen
 * pixels — the thing a person aims with — so it becomes a smaller world distance the
 * further in the board is zoomed, which is exactly what "6 pixels from the line" means.
 */
export function hitTestConnector(object: ObjectSnapshot, at: Point, zoom = 1): boolean {
  const snap = object as Partial<ConnectorSnap>;
  if (!snap.ends) return false;
  return distanceToPolyline([snap.ends.from, snap.ends.to], at) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

export const connectorObjectType: ObjectTypeSpec = {
  Component: function ConnectorType(props) {
    const { doc, snapshot, camera, selection, onObjectPointerDown, onUndoBoundary } = props;
    return (
      <ConnectorObject
        connector={snapshot as ConnectorSnap}
        doc={doc}
        camera={camera}
        selected={selection.selected}
        onObjectPointerDown={onObjectPointerDown}
        onUndoBoundary={onUndoBoundary}
      />
    );
  },
  resizable: false,
  aspectLocked: false,
  editableText: false,
  minSize: 0,
  hitTest: hitTestConnector,
};
