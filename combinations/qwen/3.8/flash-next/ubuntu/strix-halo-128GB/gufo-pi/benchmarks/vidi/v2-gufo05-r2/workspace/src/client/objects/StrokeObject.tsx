/**
 * Story 11: a sketch on the board.
 *
 * The whole of the drawing is one `<path>`: the stroke's stored points, scaled to
 * whatever size its box has been resized to, written as a smooth curve. The box comes
 * from the document and is the box story 7 moves and resizes, so nothing here knows that
 * a drag happened — `scaledPoints` multiplies by `width / baseWidth` and the sketch is
 * bigger (PRD pen.resize). The line's *weight* is not scaled with it, because it is the
 * pen that made the stroke and not the box that holds it: a sketch doubled in size is the
 * same thickness of line, twice as long.
 *
 * The one thing that is not simply the drawing is how a stroke is clicked. Its box can be
 * anything — a circle round a cluster of notes has a box the size of that cluster, mostly
 * empty — and clicking inside it means nothing. So, exactly as an arrow does: a visible
 * path that takes no pointer events, and an invisible copy of the same path as wide as the
 * rule about how close a click has to be (six screen pixels, or half the pen's width if
 * the pen was thicker), which is the only part of this component that answers a press. A
 * click in the middle of a sketch, nowhere near a line, goes on to whatever is underneath
 * (PRD pen.select, TC-16).
 */

import {
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from 'react';

import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { objectBounds, isStrokeSnapshot } from '../../shared/board-model';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { scaledPoints, type StrokeSnapshot } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { useBoardEnv } from '../board/boardEnv';
import type { ObjectProps } from './registry';

export interface StrokeObjectProps extends ObjectProps {
  /** Narrowed for you by the registry; a stroke always carries it. */
  stroke?: StrokeSnapshot;
}

export function StrokeObject(props: StrokeObjectProps) {
  const stroke = props.stroke ?? (isStrokeSnapshot(props.object) ? props.object : null);
  if (!stroke) return null;
  return <StrokeDrawing {...props} stroke={stroke} />;
}

/** The sketch itself, with its snapshot already narrowed to one. */
function StrokeDrawing({
  stroke,
  zoom,
  selected,
  onObjectPointerDown,
}: StrokeObjectProps & { stroke: StrokeSnapshot }) {
  const env = useBoardEnv();
  const box = objectBounds(stroke);
  // The drawing, in this box's own coordinates: relative to its origin, and scaled by
  // however much the box has grown since the points were written down.
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  // Half this band is how far from the line a click may be, so the shape you can hit and
  // the rule in the registry are the same number: six screen pixels at this zoom, or half
  // the pen's width, whichever is further.
  const hitWidth = Math.max(thickness, (STROKE_HIT_TOLERANCE_PX * 2) / (zoom > 0 ? zoom : 1));

  const onLinePointerDown = (event: ReactPointerEvent<SVGPathElement>) => {
    if (!env) {
      // Drawn outside a board: nothing to convert the press with, so the band is the rule.
      onObjectPointerDown(event, stroke.id);
      return;
    }
    const world = env.toWorld({ x: event.clientX, y: event.clientY });
    if (
      distanceToPolyline(points, { x: world.x - box.x, y: world.y - box.y }) >
      Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1))
    ) {
      // Inside the box, nowhere near the line: the press belongs to the board, or to
      // whatever is drawn below this one.
      return;
    }
    onObjectPointerDown(event, stroke.id);
  };

  return (
    <div
      className="stroke-object"
      role="img"
      aria-label="Drawing"
      data-object-id={stroke.id}
      data-object-type="stroke"
      data-selected={selected ? 'true' : 'false'}
      style={
        {
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          zIndex: stroke.z,
          pointerEvents: 'none',
        } as CSSProperties
      }
    >
      <svg
        className="stroke-object__svg"
        width={Math.max(0.001, box.width)}
        height={Math.max(0.001, box.height)}
        viewBox={`0 0 ${Math.max(0.001, box.width)} ${Math.max(0.001, box.height)}`}
        data-testid={`stroke-${stroke.id}`}
      >
        {d ? (
          <>
            <path
              className="stroke-object__line"
              data-testid="stroke-line"
              d={d}
              stroke={PEN_COLORS[stroke.color]}
              strokeWidth={thickness}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="stroke-object__hit"
              data-testid={`stroke-hit-${stroke.id}`}
              d={d}
              strokeWidth={hitWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              onPointerDown={onLinePointerDown}
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}
