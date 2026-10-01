import { useRef, useCallback, type ReactElement } from 'react';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config';
import {
  resolveEndpoints,
  type ConnectorSnap,
} from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  selected: boolean;
  zoom: number;
  /** Hit test: is a world point near this connector's line? */
  onPointerDown?: (e: { clientX: number; clientY: number; stopPropagation(): void }, id: string) => void;
}

/**
 * A connector (arrow) object (story 10, connector.ui).
 *
 * Renders an SVG line with an arrowhead. The endpoints are resolved from
 * the current object rects on every render, so moves by anyone redraw the
 * arrow automatically. When selected, shows two end handles for re-attach.
 */
export function ConnectorObject({
  connector,
  rects,
  selected,
  zoom,
  onPointerDown,
}: ConnectorObjectProps): ReactElement {
  const id = connector.id;
  const { from, to } = resolveEndpoints(connector, rects);

  const onPointerDownRef = useRef(onPointerDown);
  onPointerDownRef.current = onPointerDown;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.nativeEvent.button !== 0) return;
    e.stopPropagation();
    onPointerDownRef.current?.(e.nativeEvent, id);
  }, [id]);

  // Arrowhead geometry
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const ahSize = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const ahAngle = Math.PI / 6; // 30 degrees

  const ah1x = to.x - ahSize * Math.cos(angle - ahAngle);
  const ah1y = to.y - ahSize * Math.sin(angle - ahAngle);
  const ah2x = to.x - ahSize * Math.cos(angle + ahAngle);
  const ah2y = to.y - ahSize * Math.sin(angle + ahAngle);

  const sw = CONNECTOR_STROKE_WIDTH_WORLD;
  const handleSize = 8 / zoom; // constant screen size

  return (
    <g
      data-testid={`connector-object-${id}`}
      data-selected={selected || undefined}
      onPointerDown={handlePointerDown}
      style={{ cursor: selected ? 'default' : 'pointer' }}
    >
      {/* Invisible wider hit area for easier clicking */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={CONNECTOR_HIT_TOLERANCE_PX * 2 / zoom}
        style={{ pointerEvents: 'stroke' }}
      />
      {/* Visible line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={selected ? '#1565C0' : '#333'}
        strokeWidth={sw}
        style={{ pointerEvents: 'none' }}
      />
      {/* Arrowhead */}
      <polygon
        points={`${to.x},${to.y} ${ah1x},${ah1y} ${ah2x},${ah2y}`}
        fill={selected ? '#1565C0' : '#333'}
        style={{ pointerEvents: 'none' }}
      />
      {/* End handles when selected */}
      {selected && (
        <>
          <circle
            data-testid={`connector-handle-from-${id}`}
            cx={from.x}
            cy={from.y}
            r={handleSize / 2}
            fill="#FFFFFF"
            stroke="#1565C0"
            strokeWidth={1.5 / zoom}
            style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
          />
          <circle
            data-testid={`connector-handle-to-${id}`}
            cx={to.x}
            cy={to.y}
            r={handleSize / 2}
            fill="#FFFFFF"
            stroke="#1565C0"
            strokeWidth={1.5 / zoom}
            style={{ cursor: 'crosshair', pointerEvents: 'auto' }}
          />
        </>
      )}
    </g>
  );
}
