import { useCallback } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import {
  PEN_COLORS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config.js';
import {
  scaledPoints,
  strokeThickness,
  type StrokeSnap,
} from '../../shared/objects/stroke.js';
import { smoothPath } from '../../shared/geometry/simplify.js';
import type { ObjectProps } from './registry.js';

/**
 * One drawn line on the board (`src/client/objects/StrokeObject.tsx`) - the component
 * the registry points at for the `stroke` type.
 *
 * It draws what the document holds and nothing more: the stored trail scaled into the
 * box the object has now, as a path with round caps, in the ink the pen that drew it
 * was holding. No smoothing happens here - that was decided once, at the moment of
 * release, on the screen of the person who drew it - which is what makes a stroke look
 * the same on every screen rather than like a different line each time it is drawn.
 *
 * Two things about a stroke are not like the objects before it, and each is a line of
 * this file rather than an accident of one:
 *
 * - **the box is not the drawing.** A loop's box is mostly empty board, so the box
 *   answers no pointer event at all (`pen.select`): the only part of this component a
 *   click can reach is an invisible second path as wide as the click tolerance. A click
 *   inside a loop selects whatever is *under* it, which is what the person meant and
 *   what every other object on the board would do; a stroke that swallowed clicks
 *   inside itself would be a shape that hides the notes inside it.
 * - **the ink does not resize.** The scaled trail is the only thing here that follows a
 *   resize; the stroke width is the pen that was chosen, in board units, and the
 *   selection layer keeps a stroke's proportions because the registry says so. Stretch
 *   a stroke to twice the size and what got bigger is the line, not the pen.
 *
 * The box is the object's own: a stroke's stored `x`/`y`/`width`/`height` are already the
 * trail grown by half a pen, which is what lets story 7 move and resize it like any other
 * rectangle. The component adds nothing to it, and a one-pixel disagreement here would be
 * a selection outline drawn next to its own drawing.
 */

/** What a stroke is called out as to someone who cannot see it. */
export const STROKE_OBJECT_LABEL = 'Drawing';

export function StrokeObject(props: ObjectProps): JSX.Element {
  const { object, zoom, selected, gesture } = props;
  const stroke = object as StrokeSnap;

  /** Whether *this* stroke is part of a move in progress. */
  const dragging = gesture.draggingIds.has(object.id);

  const width = stroke.width ?? 0;
  const height = stroke.height ?? 0;
  // The stored trail is relative to this box and scaled to it at the same time, by the
  // model rather than here: what the object's two sizes mean is one function's business,
  // and it is the same function the hit test measures with.
  const d = smoothPath(scaledPoints(stroke));

  const ink = PEN_COLORS[stroke.color];
  const inkWidth = strokeThickness(stroke);
  // As wide as a click is allowed to be, on the screen and not on the board: the same
  // six pixels at 40% and at 400%, and never narrower than the ink itself - a click
  // that lands on the line must hit the line at any zoom.
  const hitWidth = Math.max(
    inkWidth,
    (2 * STROKE_HIT_TOLERANCE_PX) / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1),
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGPathElement>) => {
      // The line answers for the stroke: it joins the selection and begins the move,
      // and the board behind it is not told - which is the same promise every other
      // object type makes about its own body.
      gesture.onObjectPointerDown(event, object.id);
    },
    [gesture, object.id],
  );

  return (
    <div
      className="stroke-object"
      data-testid="stroke-object"
      data-object-id={object.id}
      data-stroke-object={object.id}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={STROKE_OBJECT_LABEL}
      tabIndex={0}
      style={{
        // The object's own rectangle: the trail's extremes plus half a pen, as the model
        // stored them.
        left: `${stroke.x}px`,
        top: `${stroke.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: String(stroke.z),
        ['--inverse-zoom' as string]: String(1 / (zoom || 1)),
      }}
    >
      <svg
        className="stroke-object-svg"
        data-testid="stroke-svg"
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        // A stroke drawn to the edge of its box has half its ink outside it; the padding
        // takes care of most of that, and this takes care of the round cap of a line
        // that ends exactly on the boundary.
        style={{ overflow: 'visible' }}
      >
        {/* The only part of this object a pointer can reach: invisible, as wide as the
            click tolerance, and answering only on the stroke itself. */}
        <path
          className="stroke-hit"
          data-testid="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          onPointerDown={handlePointerDown}
        />
        {/* The line itself. Drawn after the hit path so it is on top, and deaf to the
            pointer, because what it is for is being looked at. */}
        <path
          className="stroke-line"
          data-testid="stroke-line"
          d={d}
          fill="none"
          stroke={ink}
          strokeWidth={inkWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}

export default StrokeObject;
