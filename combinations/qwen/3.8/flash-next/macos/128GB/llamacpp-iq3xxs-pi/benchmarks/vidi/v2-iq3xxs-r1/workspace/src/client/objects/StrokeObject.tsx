import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  /** Selection is drawn as an outline of the box, which is where the handles sit. */
  selected: boolean;
  /**
   * Camera zoom: the clickable band around the line stays `STROKE_HIT_TOLERANCE_PX`
   * *screen* pixels wide at any zoom, so the box is not the only way to grab a stroke.
   */
  zoom?: number;
  editable?: boolean;
  /** Press on the line itself: select it and let the generic gesture move it. */
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  onSelect?(id: string): void;
}

/**
 * One drawn stroke (PRD pen.draw, pen.resize, pen.select).
 *
 * The points are scaled to the object's current box before being turned into a path,
 * so resizing the box scales the drawing in proportion, while `stroke-width` stays the
 * stored thickness in board units — a stroke that has been doubled is longer, not
 * thicker. The path is smoothed with midpoint curves, which is what makes it look
 * drawn rather than faceted, and the round line caps turn a single point into a dot
 * whose diameter is the ink.
 *
 * The component itself does not receive pointer events: only the invisible wide
 * "hit" path along the line does, so a click inside the bounding box but away from the
 * line falls through to whatever is underneath (PRD pen.select).
 */
export function StrokeObject({
  stroke,
  selected,
  zoom = 1,
  editable = true,
  onObjectPointerDown,
  onSelect,
}: StrokeObjectProps): JSX.Element {
  const points = scaledPoints(stroke);
  // The path is drawn in the object's own coordinates: the box is positioned once, by
  // `left`/`top`, and everything inside it is relative to its origin.
  const local = points.map((p) => ({ x: p.x - stroke.x, y: p.y - stroke.y }));
  const d = smoothPath(local);
  const ink = PEN_THICKNESS_WORLD[stroke.thickness];
  // Half the ink when the ink is thick, 6 px of screen otherwise: whichever is wider.
  const band = Math.max(ink, (STROKE_HIT_TOLERANCE_PX * 2) / (zoom > 0 ? zoom : 1));

  return (
    <div
      className="stroke-object"
      data-object-root=""
      data-stroke-root=""
      data-stroke-id={stroke.id}
      data-testid="stroke-object"
      data-selected={selected ? 'true' : 'false'}
      style={{
        left: `${stroke.x}px`,
        top: `${stroke.y}px`,
        width: `${stroke.width}px`,
        height: `${stroke.height}px`,
      }}
    >
      <svg
        className="stroke-svg"
        data-testid="stroke-svg"
        width={stroke.width}
        height={stroke.height}
        role="img"
        aria-label="Drawing"
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* The clickable band, along the line and never over the empty part of the box. */}
        <path
          className="stroke-hit"
          data-testid="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={band}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: editable ? 'stroke' : 'none' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            if (onObjectPointerDown) onObjectPointerDown(e.nativeEvent, stroke.id);
            else onSelect?.(stroke.id);
          }}
        />
        <path
          className="stroke-line"
          data-testid="stroke-line"
          d={d}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={ink}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
