import { useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { objectBounds, snapshotAll } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD
} from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import {
  collectConnectorViews,
  setConnectorEndpoint,
  type Endpoint
} from '../../shared/objects/connector';
import { screenToWorld } from '../canvas/camera';
import { useBoardCamera } from '../canvas/useCamera';
import type { ObjectProps } from './registry';

export type ConnectorObjectProps = ObjectProps;

const HANDLE_RADIUS_PX = 5;

interface HandleDrag {
  end: 'from' | 'to';
  point: Point;
  highlight: { id: string; side: Side } | null;
}

// Top-most object under a world point: connectors by distance to their
// line, everything else by bbox; excludes the arrow itself and the object
// the other end is attached to (releasing there snaps the handle back).
export function findConnectorTarget(
  doc: Y.Doc,
  world: Point,
  excludeId: string,
  otherObjectId: string | null,
  zoom: number
): { id: string; rect: Rect } | null {
  const views = new Map(collectConnectorViews(doc).map((v) => [v.id, v]));
  const all = snapshotAll(doc); // z ascending
  for (let i = all.length - 1; i >= 0; i--) {
    const o = all[i];
    if (o.id === excludeId || o.id === otherObjectId) continue;
    if (o.type === 'connector') {
      const v = views.get(o.id);
      if (v === undefined) continue;
      if (distanceToPolyline([v.resolved.from, v.resolved.to], world) <= CONNECTOR_HIT_TOLERANCE_PX / zoom) {
        return { id: o.id, rect: objectBounds(o) };
      }
      continue;
    }
    if (rectContains(objectBounds(o), { x: world.x, y: world.y, width: 0, height: 0 })) {
      return { id: o.id, rect: objectBounds(o) };
    }
  }
  return null;
}

// A straight arrow between two endpoints, recomputed from the document on
// every render, so it follows whenever either attached object moves (for
// local and remote peers alike). The wide transparent line carries the
// pointer (select within CONNECTOR_HIT_TOLERANCE_PX of the line, not the
// bbox); a selected arrow shows a re-attach handle at each end.
export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, editable, onObjectPointerDown } = props;
  const { camera } = useBoardCamera();
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const dragRef = useRef<HandleDrag | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const view = collectConnectorViews(doc).find((v) => v.id === obj.id);
  if (view === undefined) return <></>;
  const bbox = objectBounds(obj);
  const resolved = view.resolved;
  const w = Math.max(bbox.width, 1);
  const h = Math.max(bbox.height, 1);

  const setHandleDrag = (next: HandleDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const startHandleDrag = (end: 'from' | 'to') => (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    if (!editable) return;
    const otherEnd = end === 'from' ? view.to : view.from;
    const otherObjectId = otherEnd.kind === 'attached' ? otherEnd.objectId : null;
    const otherPoint = end === 'from' ? resolved.to : resolved.from;
    setHandleDrag({ end, point: end === 'from' ? resolved.from : resolved.to, highlight: null });

    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onMove = (ev: PointerEvent) => {
      const world = screenToWorld(cameraRef.current, { x: ev.clientX, y: ev.clientY });
      const t = findConnectorTarget(doc, world, obj.id, otherObjectId, cameraRef.current.zoom);
      setHandleDrag({
        end,
        point: world,
        highlight: t === null ? null : { id: t.id, side: nearestSide(t.rect, otherPoint) }
      });
    };
    const onUp = (ev: PointerEvent) => {
      detach();
      const world = screenToWorld(cameraRef.current, { x: ev.clientX, y: ev.clientY });
      const t = findConnectorTarget(doc, world, obj.id, null, cameraRef.current.zoom);
      setHandleDrag(null);
      if (t !== null && t.id === otherObjectId) return; // snap back: own other end
      let endpoint: Endpoint;
      if (t !== null) {
        endpoint = {
          kind: 'attached',
          objectId: t.id,
          fallback: sideAnchor(t.rect, nearestSide(t.rect, otherPoint))
        };
      } else {
        endpoint = { kind: 'free', x: world.x, y: world.y };
      }
      setConnectorEndpoint(doc, obj.id, end, endpoint);
    };
    const onCancel = () => {
      detach();
      setHandleDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const fromPoint = drag !== null && drag.end === 'from' ? drag.point : resolved.from;
  const toPoint = drag !== null && drag.end === 'to' ? drag.point : resolved.to;
  const highlightRect =
    drag !== null && drag.highlight !== null
      ? (() => {
          const o = snapshotAll(doc).find((x) => x.id === drag.highlight?.id);
          return o === undefined ? null : objectBounds(o);
        })()
      : null;

  return (
    <div
      data-testid="connector-object"
      data-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="img"
      aria-label="Arrow"
      className="connector-object"
      style={{ left: bbox.x, top: bbox.y, width: w, height: h }}
      onDoubleClick={(e) => {
        e.stopPropagation(); // never create a sticky on an arrow
      }}
    >
      <svg
        className="connector-svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ overflow: 'visible' }}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={`connector-arrow-${obj.id}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#263238" />
          </marker>
        </defs>
        <line
          data-testid="connector-hit"
          x1={fromPoint.x - bbox.x}
          y1={fromPoint.y - bbox.y}
          x2={toPoint.x - bbox.x}
          y2={toPoint.y - bbox.y}
          stroke="transparent"
          strokeWidth={(2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom}
          pointerEvents="stroke"
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!editable) return;
            onObjectPointerDown(e as unknown as React.PointerEvent<HTMLElement>, obj.id);
          }}
        />
        <line
          data-testid="connector-line"
          x1={fromPoint.x - bbox.x}
          y1={fromPoint.y - bbox.y}
          x2={toPoint.x - bbox.x}
          y2={toPoint.y - bbox.y}
          stroke={selected ? '#1E88E5' : '#263238'}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#connector-arrow-${obj.id})`}
          pointerEvents="none"
        />
        {drag !== null && drag.highlight !== null && highlightRect !== null && (
          <circle
            data-testid="connector-drop-dot"
            cx={sideAnchor(highlightRect, drag.highlight.side).x - bbox.x}
            cy={sideAnchor(highlightRect, drag.highlight.side).y - bbox.y}
            r={3 / zoom}
            fill="#1E88E5"
            pointerEvents="none"
          />
        )}
        {selected &&
          (['from', 'to'] as const).map((end) => {
            const p = end === 'from' ? fromPoint : toPoint;
            return (
              <circle
                key={end}
                data-testid={`connector-handle-${end}`}
                cx={p.x - bbox.x}
                cy={p.y - bbox.y}
                r={HANDLE_RADIUS_PX / zoom}
                fill="#ffffff"
                stroke="#1E88E5"
                strokeWidth={2 / zoom}
                style={{ cursor: 'crosshair' }}
                onPointerDown={startHandleDrag(end)}
              />
            );
          })}
      </svg>
    </div>
  );
}
