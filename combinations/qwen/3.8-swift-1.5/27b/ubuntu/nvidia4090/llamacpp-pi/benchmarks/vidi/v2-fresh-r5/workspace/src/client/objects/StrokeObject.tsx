/**
 * Stroke object renderer (story 11). Renders the smoothed SVG path scaled to
 * the object's current size, plus an invisible wider hit path so a stroke is
 * selected only when the click is within max(thickness/2,
 * STROKE_HIT_TOLERANCE_PX / zoom) of its line (pen.select). Remote strokes
 * render identically as soon as the snapshot updates.
 */
import type { JSX } from 'react';
import type { Camera } from '../canvas/camera';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  /** Camera for the zoom-dependent hit width (defaults to zoom 1). */
  camera?: Camera;
  /** Delegate pointerdown to the transform gesture (select/move). */
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
}

/**
 * A finished freehand stroke: smooth line with round ends and joins.
 */
export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const { stroke, camera, onPointerDown } = props;

  const zoom = camera?.zoom ?? 1;
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const color = PEN_COLORS[stroke.color] ?? PEN_COLORS.black;

  const points = scaledPoints(stroke);
  const d = smoothPath(points);

  // Invisible hit path: wide enough that a click within 6 screen pixels (or
  // half the thickness, whichever is larger) of the line selects the stroke.
  const hitWidthWorld = Math.max(thickness, (2 * STROKE_HIT_TOLERANCE_PX) / zoom);

  return (
    // Self-contained SVG at the world origin: object components render into
    // the (HTML) world layer div, so a raw <g> would end up in the HTML
    // namespace and never render. This svg owns the SVG namespace; its user
    // space equals world coordinates.
    <svg
      data-testid={`stroke-${stroke.id}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidthWorld}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: 'move' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown?.(e, stroke.id);
        }}
      />
      <path
        data-testid={`stroke-path-${stroke.id}`}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Drawing"
      />
    </svg>
  );
}
