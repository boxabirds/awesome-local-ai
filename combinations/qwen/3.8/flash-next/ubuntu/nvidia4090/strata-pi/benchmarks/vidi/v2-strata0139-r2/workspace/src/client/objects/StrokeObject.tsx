import type { PointerEvent as ReactPointerEvent } from "react";
import { STROKE_HIT_TOLERANCE_PX } from "../../shared/config";
import {
  strokeColorHex,
  strokeThicknessWorld,
  scaledPoints,
  type StrokeSnap,
} from "../../shared/objects/stroke";
import { smoothPath } from "../../shared/geometry/simplify";
import type { ObjectProps } from "./registry";

/**
 * `objects.StrokeObject` — one freehand drawing (story 11).
 *
 * The points are mapped through `scaledPoints` (so a resized stroke draws resized,
 * in the same shape) and then into this object's own box, exactly like a connector
 * draws its line. The `d` is `smoothPath`: quadratic curves through the midpoints
 * of consecutive segments, which round the corners without moving the line more
 * than half a segment.
 *
 * Two paths are drawn:
 *
 * - the **visible** one, `strokeWidth` = the pen thickness in board units, so it
 *   scales with the board like everything else;
 * - an invisible **hit path**, twice as wide as the thickness and never narrower
 *   than `STROKE_HIT_TOLERANCE_PX` converted to board units at the current zoom —
 *   the same target the model's line-distance hit test gives (`pen.select`), so a
 *   press that lands on it selects the stroke and gets the generic move and resize
 *   gestures for free.
 *
 * The root div is `pointer-events: none`: a stroke's box is mostly empty space, and
 * pressing inside that box but far from the line must reach whatever is underneath
 * (a sticky note stays clickable through the box) or the board itself, which answers
 * a click on the line with the same hit test.
 */
export function StrokeObject({ object, zoom, selected, dragging, onObjectPointerDown }: ObjectProps) {
  const stroke = object as StrokeSnap;
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const width = stroke.width;
  const height = stroke.height;

  // The drawn path, in this object's own coordinate space.
  const points = scaledPoints(stroke).map((point) => ({ x: point.x - stroke.x, y: point.y - stroke.y }));
  const path = smoothPath(points);
  const hex = strokeColorHex(stroke);
  const thickness = strokeThicknessWorld(stroke);
  const hitWidth = Math.max(thickness * 2, (STROKE_HIT_TOLERANCE_PX * 2) / scale);
  const single = points.length === 1;
  const dot = single ? points[0]! : null;

  const press = (event: ReactPointerEvent<SVGElement>): void => {
    onObjectPointerDown(event, stroke.id);
  };

  return (
    <div
      className="stroke-object"
      data-testid="stroke-object"
      data-object-type="stroke"
      data-note-id={stroke.id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-pen-color={stroke.color}
      data-pen-thickness={stroke.thickness}
      data-stroke-points={points.length}
      aria-label="Drawing"
      style={{
        left: `${round(stroke.x)}px`,
        top: `${round(stroke.y)}px`,
        width: `${round(width)}px`,
        height: `${round(height)}px`,
        zIndex: stroke.z,
        pointerEvents: "none",
      }}
    >
      <svg
        className="stroke-svg"
        data-testid="stroke-svg"
        width={round(width)}
        height={round(height)}
        viewBox={`0 0 ${round(width)} ${round(height)}`}
        aria-hidden="true"
        style={{ overflow: "visible" }}
      >
        {single ? (
          <circle
            data-testid="stroke-dot"
            cx={round(dot!.x)}
            cy={round(dot!.y)}
            r={round(thickness / 2)}
            fill={hex}
            pointerEvents="none"
          />
        ) : (
          <path
            data-testid="stroke-path"
            d={path}
            fill="none"
            stroke={hex}
            strokeWidth={round(thickness)}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
        {single ? (
          <circle
            className="stroke-hit"
            data-testid="stroke-hit"
            cx={round(dot!.x)}
            cy={round(dot!.y)}
            r={round(hitWidth / 2)}
            fill="transparent"
            pointerEvents="fill"
            onPointerDown={press}
          />
        ) : (
          <path
            className="stroke-hit"
            data-testid="stroke-hit"
            d={path}
            fill="none"
            stroke="transparent"
            strokeWidth={round(hitWidth)}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
            onPointerDown={press}
          />
        )}
      </svg>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
