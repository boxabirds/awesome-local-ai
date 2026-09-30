import { useCallback, type ReactElement } from 'react';
import type { StrokeSnap } from '@shared/objects/stroke';
import { smoothPath } from '@shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '@shared/config';
import type { Point } from '@client/canvas/camera';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  zoom: number;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
}

/**
 * Renders a stroke as an SVG path with round caps/joins.
 * Only the line area (within hit tolerance) captures pointer events.
 */
export function StrokeObject({ stroke, selected, zoom, onObjectPointerDown }: StrokeObjectProps): ReactElement {
  // Build points relative to the stroke's bounding box origin
  const scaleX = stroke.baseWidth > 0 ? stroke.width / stroke.baseWidth : 1;
  const scaleY = stroke.baseHeight > 0 ? stroke.height / stroke.baseHeight : 1;
  const localPts: Point[] = [];
  for (let i = 0; i < stroke.points.length - 1; i += 2) {
    localPts.push({
      x: stroke.points[i] * scaleX,
      y: stroke.points[i + 1] * scaleY,
    });
  }
  const d = smoothPath(localPts);
  const color = PEN_COLORS[stroke.color];
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];

  // Hit area width: max of thickness and 2x the hit tolerance in world units
  const hitWidth = Math.max(thickness, 2 * STROKE_HIT_TOLERANCE_PX / zoom);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (onObjectPointerDown) {
        onObjectPointerDown(e.nativeEvent as unknown as PointerEvent, stroke.id);
      }
    },
    [stroke.id, onObjectPointerDown],
  );

  return (
    <svg
      data-testid={`stroke-${stroke.id}`}
      aria-label="Drawing"
      data-object-id={stroke.id}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
      width={stroke.width}
      height={stroke.height}
    >
      {/* Invisible wider path for hit testing */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={handlePointerDown}
        data-testid={`stroke-hit-${stroke.id}`}
      />
      {/* Visible stroke path */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-testid={`stroke-path-${stroke.id}`}
      />
      {selected && (
        <rect
          x={-1}
          y={-1}
          width={stroke.width + 2}
          height={stroke.height + 2}
          fill="none"
          stroke="#1E88E5"
          strokeWidth={1.5 / zoom}
          strokeDasharray={`${4 / zoom} ${2 / zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}
