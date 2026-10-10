import { useCallback } from 'react';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Point } from '../../shared/geometry';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import type { ObjectProps, PointerEventLike } from './registry';

/**
 * One finished stroke (`stroke.object`, `pen.render`, `pen.select`).
 *
 * The stroke is drawn from its own points, in its own box: `scaledPoints` scales
 * the recorded path by however much the box has been resized, and `smoothPath`
 * bends it. Nothing in this component knows about the pen, the tool, or how the
 * points were captured - a stroke that arrived from another person's `createStroke`
 * is drawn the same way, in the same frame its snapshot appears (`pen.share`).
 *
 * The thickness is **not** scaled, and neither is the line's colour: resizing a
 * stroke makes it longer in proportion, never fatter (`pen.resize`).
 *
 * Two paths are drawn for one line, exactly as an arrow does: an invisible one as
 * wide as the selection tolerance, which is what a pointer lands on, and the line
 * itself. That is what makes `pen.select` true in the DOM as well as in the
 * registry - a click inside a stroke's box but away from its line goes through the
 * wrapper, which is `pointer-events: none`, and lands on whatever is below
 * (`TC-16`).
 */
export type StrokeObjectProps = ObjectProps<StrokeSnap>;

const colourOf = (color: PenColor | undefined): string =>
  PEN_COLORS[color ?? DEFAULT_PEN_COLOR] ?? PEN_COLORS[DEFAULT_PEN_COLOR];

const thicknessOf = (thickness: PenThickness | undefined): number =>
  PEN_THICKNESS_WORLD[thickness ?? DEFAULT_PEN_THICKNESS] ?? PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];

/** How wide the invisible click band has to be, in world units, at this zoom. */
function hitBandWidth(stroke: StrokeSnap, zoom: number): number {
  const half = thicknessOf(stroke.thickness) / 2;
  const screen = STROKE_HIT_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  return Math.max(half, screen) * 2;
}

/**
 * Is this world point on this stroke's **line**?
 *
 * Not its box: a stroke is a drawing, and a drawing is only where its ink is. The
 * distance is measured against the points as they are drawn now - scaled by the
 * current box, in the stroke's own space - and the band is the thicker of half the
 * line's own thickness in board units and `STROKE_HIT_TOLERANCE_PX` of screen
 * converted to board units at this zoom, so a thin line is exactly as easy to hit
 * at 25% as at 400% (`pen.select`, TC-15).
 */
export function hitTestStroke(stroke: StrokeSnap, worldPoint: Point, zoom: number): boolean {
  const points = scaledPoints(stroke);
  if (points.length === 0) {
    return false;
  }
  const tolerance = hitBandWidth(stroke, zoom) / 2;
  // A distance does not care where the box is; measuring in the stroke's own space
  // is the same measurement, with one subtraction fewer.
  return distanceToPolyline(points, { x: worldPoint.x - stroke.x, y: worldPoint.y - stroke.y }) <= tolerance;
}

export function StrokeObject(props: StrokeObjectProps) {
  const { obj: stroke, zoom, selected, dragging, editable = true, onObjectPointerDown } = props;

  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const width = stroke.width;
  const height = stroke.height;
  const strokeWidth = thicknessOf(stroke.thickness);
  const colour = colourOf(stroke.color);
  const hitWidth = hitBandWidth(stroke, zoom);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.stopPropagation();
      if (event.button !== 0) {
        return;
      }
      // Selecting a stroke, dragging it and resizing it is the board's gesture
      // (`sel.transform`): this component only says that the press landed on it.
      onObjectPointerDown(event as unknown as PointerEventLike, stroke.id);
    },
    [onObjectPointerDown, stroke.id],
  );

  const handleDoubleClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    // A stroke holds no text (`editableText: false`), so a double-click on it is
    // nothing and must not become something.
    event.stopPropagation();
    event.preventDefault();
  }, []);

  return (
    <div
      className="stroke-object"
      data-testid={`stroke-object-${stroke.id}`}
      data-stroke={stroke.id}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${stroke.x}px, ${stroke.y}px)`,
        zIndex: stroke.z,
      }}
    >
      <svg
        className="stroke-object__svg"
        data-testid={`stroke-${stroke.id}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Drawing"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        {/* The band a click lands on: as wide as the selection tolerance, invisible. */}
        <path
          className="stroke-object__hit"
          data-testid={`stroke-hit-${stroke.id}`}
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
        />
        <path
          className="stroke-object__line"
          data-testid={`stroke-line-${stroke.id}`}
          d={d}
          fill="none"
          stroke={colour}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
          data-stroke-width={strokeWidth}
          data-selected={selected ? 'true' : 'false'}
          data-dragging={dragging ? 'true' : 'false'}
        />
      </svg>
    </div>
  );
}
