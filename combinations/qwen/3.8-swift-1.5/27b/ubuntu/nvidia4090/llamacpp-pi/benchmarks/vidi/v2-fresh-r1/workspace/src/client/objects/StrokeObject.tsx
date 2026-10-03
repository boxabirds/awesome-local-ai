// Stroke object component (story 11): renders a freehand stroke as a smooth
// SVG path with round caps/joins. Selecting a stroke requires clicking close
// to its line; a click farther from the line falls through to the object
// underneath (onObjectMiss).

import { type PointerEvent as ReactPointerEvent } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { scaledPoints, hitStroke, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { screenToWorld } from '../canvas/camera';
import { useCameraContext } from '../canvas/BoardViewport';
import type { ObjectProps } from './registry';

export function StrokeObject({
  obj,
  selected,
  onObjectPointerDown,
  onObjectDoubleClick,
  onObjectMiss,
}: ObjectProps) {
  const api = useCameraContext();
  const s = obj as StrokeSnap;
  const x = s.x;
  const y = s.y;
  const w = s.width ?? 0;
  const h = s.height ?? 0;
  const color = PEN_COLORS[s.color as PenColor] ?? PEN_COLORS.black;
  const thickness = PEN_THICKNESS_WORLD[s.thickness as PenThickness] ?? PEN_THICKNESS_WORLD.medium;

  // World-space path (the SVG's viewBox is in world coordinates).
  const d = smoothPath(scaledPoints(s));

  const handlePointerDown = (e: ReactPointerEvent<Element>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const world = screenToWorld(api.camera, { x: e.clientX, y: e.clientY });
    if (hitStroke(s, world, api.camera.zoom)) {
      onObjectPointerDown(e, obj.id);
    } else {
      // Click inside the bbox but away from the line: select what is
      // underneath (or nothing) — never the stroke.
      onObjectMiss?.(e, obj.id);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<Element>) => {
    e.stopPropagation();
    onObjectDoubleClick(obj.id);
  };

  return (
    <div
      data-testid="stroke-object"
      data-selected={selected || undefined}
      role="img"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={w}
        height={h}
        viewBox={`${x} ${y} ${w} ${h}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label="Drawing"
        />
      </svg>
    </div>
  );
}
