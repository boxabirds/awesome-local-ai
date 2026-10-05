import { useRef, useState, type JSX } from 'react';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';
import {
  resolveEndpoints,
  nearestSide,
  sideAnchor,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { screenToWorld, type Point, type Camera } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import type { ObjectProps } from './registry';

/**
 * One connector (arrow) in the world layer (story 10). Renders an SVG line
 * with an arrowhead. Endpoints are resolved from live object rects on every
 * render, so moves by anyone redraw the arrow automatically. When selected,
 * shows two end handles for re-attaching.
 */
export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, snapshot: snapshotProp, camera: cameraProp, onObjectPointerDown, undo } = props;
  const snapshot = snapshotProp ?? [];
  const camera: Camera = cameraProp ?? { x: 0, y: 0, zoom: 1 };

  const [handleDrag, setHandleDrag] = useState<{ end: 'from' | 'to'; current: Point } | null>(null);
  const handleDragRef = useRef<{ end: 'from' | 'to' } | null>(null);

  // Build rects map from snapshot
  const rects = new Map<string, Rect>();
  for (const s of snapshot) {
    rects.set(s.id, objectBounds(s));
  }

  // Parse endpoints from the object snapshot
  const from = parseEndpoint(obj.from);
  const to = parseEndpoint(obj.to);

  if (!from || !to) return <></>;

  // Resolve to concrete points
  const { from: fromPt, to: toPt } = resolveEndpoints(from, to, rects);

  // If a handle is being dragged, override that endpoint
  const displayFrom = handleDrag?.end === 'from' ? handleDrag.current : fromPt;
  const displayTo = handleDrag?.end === 'to' ? handleDrag.current : toPt;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onObjectPointerDown(e, obj.id);
  };

  const startHandleDrag = (end: 'from' | 'to') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    handleDragRef.current = { end };
    setHandleDrag({ end, current: world });
  };

  const onHandleMove = (e: React.PointerEvent) => {
    if (!handleDragRef.current) return;
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    setHandleDrag({ end: handleDragRef.current.end, current: world });
  };

  const onHandleUp = (e: React.PointerEvent) => {
    if (!handleDragRef.current) return;
    const end = handleDragRef.current.end;
    handleDragRef.current = null;
    setHandleDrag(null);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }

    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    // Hit-test for re-attach
    let target: ObjectSnapshot | null = null;
    for (let i = snapshot.length - 1; i >= 0; i--) {
      const s = snapshot[i];
      if (s.id === obj.id) continue;
      const r = objectBounds(s);
      if (world.x >= r.x && world.x <= r.x + r.width && world.y >= r.y && world.y <= r.y + r.height) {
        target = s;
        break;
      }
    }

    // Check if target is the object at the opposite end
    const oppositeEnd = end === 'from' ? to : from;
    if (target && oppositeEnd.kind === 'attached' && target.id === oppositeEnd.objectId) {
      return; // snap back
    }

    undo?.boundary();
    let newEp: Endpoint;
    if (target) {
      const r = objectBounds(target);
      const otherPt = end === 'from' ? toPt : fromPt;
      const side = nearestSide(r, otherPt);
      const anchor = sideAnchor(r, side);
      newEp = { kind: 'attached', objectId: target.id, fallback: anchor };
    } else {
      newEp = { kind: 'free', x: world.x, y: world.y };
    }

    setConnectorEndpoint(doc, obj.id, end, newEp);
    undo?.boundary();
  };

  // Arrowhead calculation
  const angle = Math.atan2(displayTo.y - displayFrom.y, displayTo.x - displayFrom.x);
  const arrowSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const arrowAngle = Math.PI / 6;

  const arrow1X = displayTo.x - arrowSize * Math.cos(angle - arrowAngle);
  const arrow1Y = displayTo.y - arrowSize * Math.sin(angle - arrowAngle);
  const arrow2X = displayTo.x - arrowSize * Math.cos(angle + arrowAngle);
  const arrow2Y = displayTo.y - arrowSize * Math.sin(angle + arrowAngle);

  return (
    <div
      role="group"
      aria-label={`Connector${selected ? '' : ''}`}
      data-connector-id={obj.id}
      data-selected={selected}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      onPointerDown={handlePointerDown}
    >
      <svg
        style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }}
        width={1}
        height={1}
      >
        <line
          x1={displayFrom.x}
          y1={displayFrom.y}
          x2={displayTo.x}
          y2={displayTo.y}
          stroke={selected ? '#1A73E8' : '#263238'}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        />
        <polygon
          points={`${displayTo.x},${displayTo.y} ${arrow1X},${arrow1Y} ${arrow2X},${arrow2Y}`}
          fill={selected ? '#1A73E8' : '#263238'}
        />
      </svg>

      {/* End handles when selected */}
      {selected && (
        <>
          <div
            data-testid="connector-handle-from"
            style={{
              position: 'absolute',
              left: displayFrom.x - 5,
              top: displayFrom.y - 5,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#1A73E8',
              border: '2px solid white',
              cursor: 'crosshair',
              pointerEvents: 'auto',
              touchAction: 'none',
            }}
            onPointerDown={startHandleDrag('from')}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
          />
          <div
            data-testid="connector-handle-to"
            style={{
              position: 'absolute',
              left: displayTo.x - 5,
              top: displayTo.y - 5,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#1A73E8',
              border: '2px solid white',
              cursor: 'crosshair',
              pointerEvents: 'auto',
              touchAction: 'none',
            }}
            onPointerDown={startHandleDrag('to')}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
          />
        </>
      )}
    </div>
  );
}

function parseEndpoint(data: unknown): Endpoint | null {
  if (data === null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'attached' && typeof d.objectId === 'string' && d.fallback && typeof d.fallback === 'object') {
    const f = d.fallback as Record<string, unknown>;
    if (typeof f.x === 'number' && typeof f.y === 'number') {
      return { kind: 'attached', objectId: d.objectId as string, fallback: { x: f.x, y: f.y } };
    }
  }
  if (d.kind === 'free' && typeof d.x === 'number' && typeof d.y === 'number') {
    return { kind: 'free', x: d.x, y: d.y };
  }
  return null;
}

