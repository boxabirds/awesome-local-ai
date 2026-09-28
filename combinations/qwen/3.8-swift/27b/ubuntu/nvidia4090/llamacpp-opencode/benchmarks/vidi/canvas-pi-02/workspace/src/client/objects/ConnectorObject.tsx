// A connector (arrow) on the board (story 10, conn.render /
// conn.free_endpoint / conn.reattach): a straight line between its two
// resolved endpoints with an arrowhead at the `to` end. The line follows
// its targets because the endpoints are re-resolved from the live document
// on every render (conn.follow).
//
// The component stores NOTHING derived: it renders the resolved line and,
// when selected, the two draggable endpoint handles. Dragging a handle to an
// object re-attaches that end there; to empty board it becomes a free
// endpoint at the drop point (the Board performs the hit test).

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { connectorResolved, connectorSnapshot } from '../../shared/objects/connector';
import type { ObjectProps } from './registry';

const HANDLE_HIT_RADIUS_PX = 14; // generous hit area (screen px) for the handles

export function ConnectorObject(props: ObjectProps): ReactElement | null {
  const { obj, doc, zoom, selected, locked, onReattachEnd } = props;
  const snap = props.connector ?? connectorSnapshot(doc, obj.id);
  if (snap === null) return null;

  // The live resolved endpoints (follow the targets, conn.follow).
  const line = props.rects !== undefined ? resolveEndpoints(snap, props.rects) : connectorResolved(doc, obj.id);
  if (line === null) return null;

  const { from, to } = line;
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const sw = CONNECTOR_STROKE_WIDTH_WORLD;
  const dotR = CONNECTOR_DOT_RADIUS_PX / zoom;
  const handleR = HANDLE_HIT_RADIUS_PX / zoom;

  // Unique per-instance marker id (the arrowhead), scoped to avoid clashes
  // between connectors.
  const markerId = `arrow-${obj.id}`;

  const dragEndRef = useRef<'from' | 'to' | null>(null);

  const onHandlePointerDown = (end: 'from' | 'to') => (e: ReactPointerEvent<SVGCircleElement>): void => {
    e.stopPropagation(); // never select/drag the whole connector
    if (locked || onReattachEnd === undefined) return;
    dragEndRef.current = end;
    const onMove = (_e: PointerEvent): void => {
      // The window listeners only keep the drag alive; the release point is
      // read on up (the Board does the world conversion + hit test).
    };
    const onUp = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragEndRef.current !== null && onReattachEnd !== undefined) {
        onReattachEnd(obj.id, dragEndRef.current, { x: e.clientX, y: e.clientY });
      }
      dragEndRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Clean up on unmount (a remote deletion mid-drag).
  useEffect(() => () => {
    dragEndRef.current = null;
  }, []);

  return (
    <div
      role="group"
      aria-label="Arrow"
      data-testid="connector-object"
      data-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      className={`connector-object${selected ? ' connector-object--selected' : ''}`}
      style={{ left: minX, top: minY, width: 0, height: 0, overflow: 'visible' }}
    >
      <svg
        width={Math.max(1, Math.abs(to.x - from.x))}
        height={Math.max(1, Math.abs(to.y - from.y))}
        viewBox={`0 0 ${Math.max(1, Math.abs(to.x - from.x))} ${Math.max(1, Math.abs(to.y - from.y))}`}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <defs>
          <marker
            id={markerId}
            markerWidth={10}
            markerHeight={10}
            refX={9}
            refY={5}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#4B5563" />
          </marker>
        </defs>
        <line
          data-testid="connector-line"
          x1={from.x - minX}
          y1={from.y - minY}
          x2={to.x - minX}
          y2={to.y - minY}
          stroke="#4B5563"
          strokeWidth={sw}
          strokeLinecap="round"
          markerEnd={`url(#${markerId})`}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => props.onPointerDown(e as unknown as React.PointerEvent, obj.id)}
        />
        {selected && !locked && onReattachEnd !== undefined && (
          <>
            <circle
              data-testid="connector-handle"
              data-end="from"
              cx={from.x - minX}
              cy={from.y - minY}
              r={handleR}
              fill="transparent"
              style={{ cursor: 'grab', pointerEvents: 'auto' }}
              onPointerDown={onHandlePointerDown('from')}
            />
            <circle
              cx={from.x - minX}
              cy={from.y - minY}
              r={dotR}
              className="connector-dot connector-dot--handle"
              style={{ pointerEvents: 'none' }}
            />
            <circle
              data-testid="connector-handle"
              data-end="to"
              cx={to.x - minX}
              cy={to.y - minY}
              r={handleR}
              fill="transparent"
              style={{ cursor: 'grab', pointerEvents: 'auto' }}
              onPointerDown={onHandlePointerDown('to')}
            />
            <circle
              cx={to.x - minX}
              cy={to.y - minY}
              r={dotR}
              className="connector-dot connector-dot--handle"
              style={{ pointerEvents: 'none' }}
            />
          </>
        )}
      </svg>
    </div>
  );
}
