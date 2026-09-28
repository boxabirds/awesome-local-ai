import { useCallback } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  zoom: number;
  camera: Camera;
  onSelect(id: string): void;
  onToggleSelect(id: string): void;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
}

/**
 * Renders a stroke as an SVG path with round caps and joins.
 * Handles click selection by line-distance hit test.
 */
export function StrokeObject({
  stroke, selected, zoom, camera,
  onSelect, onToggleSelect, onObjectPointerDown,
}: StrokeObjectProps) {
  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);
  const thicknessWorld = PEN_THICKNESS_WORLD[stroke.thickness];
  const color = PEN_COLORS[stroke.color];

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Hit test: only select if click is close to the line
    // Convert screen click to world coords (viewport is fixed inset 0, so clientX/Y are viewport-relative)
    const worldPt = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    const tolerance = Math.max(thicknessWorld / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    const dist = distanceToPolyline(pts, worldPt);
    if (dist > tolerance) return; // Not on the line, let click fall through

    e.stopPropagation();
    if (e.shiftKey) {
      onToggleSelect(stroke.id);
    } else {
      onSelect(stroke.id);
    }
    if (onObjectPointerDown) {
      onObjectPointerDown(e.nativeEvent as any, stroke.id);
    }
  }, [stroke.id, zoom, camera, pts, thicknessWorld, onSelect, onToggleSelect, onObjectPointerDown]);

  return (
    <div
      data-testid={`stroke-object-${stroke.id}`}
      data-stroke-id={stroke.id}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        pointerEvents: 'auto',
        cursor: 'default',
      }}
      onPointerDown={handlePointerDown}
    >
      <svg
        width={stroke.width}
        height={stroke.height}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
        aria-label="Drawing"
        role="img"
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thicknessWorld}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={selected ? { filter: 'drop-shadow(0 0 2px rgba(25,118,210,0.7))' } : undefined}
        />
      </svg>
    </div>
  );
}
