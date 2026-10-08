import * as React from 'react';
import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints } from '../../shared/objects/stroke';
import type { StrokeSnap, PenThickness } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { registerObjectType } from './registry';

interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  camera: Camera;
}

export function StrokeObject(props: StrokeObjectProps): React.JSX.Element {
  const { stroke, selected, camera } = props;

  // Compute scaled points and smooth path for rendering
  const pts = scaledPoints(stroke);
  if (pts.length === 0) return <g data-object-id={stroke.id} data-type="stroke" />;

  const pathD = smoothPath(pts);
  const strokeWidth = PEN_THICKNESS_WORLD[stroke.thickness];

  return (
    <g
      role="group"
      aria-label="Drawing"
      data-object-id={stroke.id}
      data-type="stroke"
      tabIndex={selected ? 0 : -1}
    >
      <path
        d={pathD}
        stroke={PEN_COLORS[stroke.color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Selection outline */}
      {selected && (
        <rect
          x={stroke.x - 2}
          y={stroke.y - 2}
          width={(stroke.width ?? 0) + 4}
          height={(stroke.height ?? 0) + 4}
          fill="none"
          stroke="#1a73e8"
          strokeWidth={2}
          rx={4}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/** Hit test: returns true if point is within tolerance of the stroke's line. */
export function strokeHitTest(
  s: StrokeSnap,
  p: { x: number; y: number },
  zoom: number,
): boolean {
  const tolerance = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  const pts = scaledPoints(s);
  return distanceToPolyline(pts, p) <= tolerance;
}

// --- Registry registration ---
registerObjectType('stroke', {
  Component: StrokeObject as any,
  resizable: true,
  aspectLocked: true,
  minSize: 4,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: { x: number; y: number }): boolean {
    // Handle both raw snapshots and Y.Map objects
    const hasGet = typeof (obj as any).get === 'function';
    const thickness = hasGet ? (obj.get('thickness') as PenThickness) : (obj as unknown as StrokeSnap).thickness;
    const tVal = PEN_THICKNESS_WORLD[thickness];
    const tolerance = Math.max(typeof tVal === 'number' ? tVal / 2 : PEN_THICKNESS_WORLD['medium'] / 2, STROKE_HIT_TOLERANCE_PX);
    const pts = scaledPoints(obj as unknown as StrokeSnap);
    return distanceToPolyline(pts, worldPoint) <= tolerance;
  },
});
