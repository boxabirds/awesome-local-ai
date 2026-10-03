/**
 * A freehand stroke drawn on the board (`stroke.render`, `pen.select`).
 *
 * The line is stored relative to its bounding box at the size it was drawn at, so what is painted
 * is `scaledPoints` — those points stretched to the box's *current* size — written as a smooth
 * path of cubic curves. The object layer already scales by zoom, so the path is authored in world
 * units and grows with the board; only the click tolerance is divided by zoom to stay a fixed size
 * to the eye.
 *
 * Two kinds of click reach a stroke:
 *
 * - **Selecting it** (`pen.select`): a pointer within `max(half the thickness,
 *   STROKE_HIT_TOLERANCE_PX / zoom)` of the line. That reach is a wide invisible stroke under the
 *   visible one, so it means the same number of screen pixels at every zoom. The box itself is
 *   pointer-transparent, so a click inside a stroke's bounding box but far from its ink falls
 *   through to whatever is underneath — a stroke is never selected by its empty middle.
 * - **Dragging / resizing it**: the ordinary object gestures, once selected (`pen.move`,
 *   `pen.resize`). A stroke is aspect-locked, so it never skews (`ink.preserve`).
 *
 * A lone point (a click) is drawn as a filled dot rather than a path, because a round cap on a
 * zero-length subpath is not reliably painted across browsers.
 */
import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';

import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { useCameraContext } from '../canvas/CameraContext';
import type { ObjectProps } from './registry';

export type StrokeObjectProps = ObjectProps & { obj: StrokeSnap };

export function StrokeObject(props: StrokeObjectProps) {
  const { obj, selected, onObjectPointerDown } = props;
  const { zoom } = useCameraContext().camera;

  const points = scaledPoints(obj);
  const color = PEN_COLORS[obj.color];
  const thickness = PEN_THICKNESS_WORLD[obj.thickness];
  // The reach a click has, in world units, so it is a fixed number of screen pixels at any zoom.
  const reach = Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  const centre = points[0] ?? { x: obj.width / 2, y: obj.height / 2 };

  const select = useCallback(
    (event: ReactPointerEvent<Element>) => {
      event.stopPropagation();
      onObjectPointerDown(event as unknown as ReactPointerEvent<HTMLElement>, obj.id);
    },
    [obj.id, onObjectPointerDown],
  );

  const viewBox = `0 0 ${obj.width} ${obj.height}`;
  const dot = points.length === 1;

  return (
    <div
      className="stroke-object"
      data-testid="stroke-object"
      data-object-id={obj.id}
      data-selected={selected}
      // World geometry and ink, for end-to-end tests to read what is painted.
      data-stroke-x={obj.x}
      data-stroke-y={obj.y}
      data-stroke-width={obj.width}
      data-stroke-height={obj.height}
      data-color={obj.color}
      data-thickness={obj.thickness}
      data-points={points.length}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        overflow: 'visible',
        // The box is not clickable; only the ink is, so a stroke never hides what it covers.
        pointerEvents: 'none',
      }}
    >
      <svg
        viewBox={viewBox}
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        role="img"
        aria-label="Drawing"
      >
        {dot ? (
          <>
            <circle
              data-testid="stroke-hit"
              cx={centre.x}
              cy={centre.y}
              r={reach}
              fill="transparent"
              style={{ pointerEvents: 'fill', cursor: 'pointer' }}
              onPointerDown={select}
            />
            <circle cx={centre.x} cy={centre.y} r={thickness / 2} fill={color} />
          </>
        ) : (
          <>
            {/* The invisible wide stroke is what a click lands on within tolerance, at any zoom. */}
            <path
              data-testid="stroke-hit"
              d={smoothPath(points)}
              fill="none"
              stroke="transparent"
              strokeWidth={reach * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={select}
            />
            <path
              data-testid="stroke-path"
              d={smoothPath(points)}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
            />
          </>
        )}
      </svg>
    </div>
  );
}
