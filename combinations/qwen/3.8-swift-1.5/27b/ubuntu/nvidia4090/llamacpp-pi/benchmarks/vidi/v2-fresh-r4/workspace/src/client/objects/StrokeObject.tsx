/**
 * StrokeObject (story 11): renders a stroke as an SVG path with round
 * caps/joins, using smoothPath on the scaled points.
 *
 * Selection: the SVG element receives pointer events; the hit test uses
 * distanceToPolyline to check if the click is near the line. If not near
 * the line, the event is not stopped (bubbles to objects below / board).
 */
import type { JSX } from 'react';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  zoom: number;
  camera: Camera;
  onPointerDown?(e: React.PointerEvent, id: string): void;
}

export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const { stroke, selected, zoom, camera, onPointerDown } = props;
  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);
  const color = PEN_COLORS[stroke.color] ?? PEN_COLORS.black;
  const strokeWidth = PEN_THICKNESS_WORLD[stroke.thickness] ?? 4;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPointerDown || e.button !== 0) return;
    
    // Hit test: is the click near the line?
    const viewport = (e.currentTarget as unknown as HTMLElement).closest('.board-viewport');
    const rect = viewport?.getBoundingClientRect();
    const vx = e.clientX - (rect?.left ?? 0);
    const vy = e.clientY - (rect?.top ?? 0);
    const world = screenToWorld(camera, { x: vx, y: vy });
    
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[stroke.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    
    if (distanceToPolyline(pts, world) > tolerance) {
      // Not near the line: don't stop propagation, let it pass through
      return;
    }
    
    e.stopPropagation();
    onPointerDown(e as unknown as React.PointerEvent, stroke.id);
  };

  return (
    <svg
      data-vidi6="stroke-object"
      className={`stroke-object${selected ? ' stroke-object--selected' : ''}`}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        overflow: 'visible',
      }}
      aria-label="Drawing"
      role="img"
      onPointerDown={handlePointerDown}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
