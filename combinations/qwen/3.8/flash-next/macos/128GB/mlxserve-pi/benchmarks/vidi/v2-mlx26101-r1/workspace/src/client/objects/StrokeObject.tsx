// A stroke on the board (story 11, pen.*).
//
// An `<svg>` the size of the stroke's box, holding one path — the same `smoothPath` the live
// preview was painted with, so the stroke that appears is the line that was drawn and not a
// different-looking thing that arrived a moment later. The box is the stroke's for all of
// story 7's purposes (selection, move, resize handles, marquee, the object list) because the
// stroke is a first-class object; what it is *not* is a hit target, and that distinction is the
// whole content of this file.
//
// Three details are load-bearing:
//
// 1. The wrapper takes no pointer events; only the painted line does, at a width of at least
//    the screen allowance a person needs to catch a thin line (pen.select). A stroke's box is
//    mostly empty board — a squiggle's bounding box is a rectangle nobody drew — so an ordinary
//    box-sized target would steal presses from everything the line happens to pass over. This
//    is what makes "select it by clicking the line" and "clicks through its empty box" the same
//    one rule, in the DOM as well as in `registry.hitTest`.
//
// 2. The path is built from `scaledPoints`, in the box's own units, with a matching viewBox.
//    That is what makes a resize scale the drawing instead of sliding it about: a handle that
//    doubles the box doubles the coordinates inside it, in both axes, because a sketch that
//    stretched unevenly stopped being the thing that was drawn (pen.resize).
//
// 3. `overflow: visible`, because a stroke's extremes touch its edges — that is how the box was
//    computed — and a nib half as wide as a line cap would otherwise be clipped flat at exactly
//    the four points where a sketch usually ends.
//
// The component owns nothing: no state, no document, no callback it needs. It is a picture of a
// snapshot, which is the only way a stroke drawn by one person can appear on another's screen.

import { PEN_COLORS, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { scaledPoints, strokeThickness, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry';
import type { ObjectProps } from './registry';

/**
 * How wide a hit target the line gets, in board units: twice the registry's tolerance — half the
 * nib, or the screen allowance a person needs to catch a thin line, whichever is wider. The
 * screen half of that is what a person needs to catch a thin line with a mouse (pen.select), and
 * it is the same number `registry.hitTest` asks for, so where the DOM says "this press is on the
 * stroke" and where the model says it cannot disagree.
 */
function hitWidth(thicknessWorld: number, zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return 2 * Math.max(thicknessWorld / 2, STROKE_HIT_TOLERANCE_PX / z);
}

export function StrokeObject(props: ObjectProps) {
  const { obj, zoom, selected, onObjectPointerDown } = props;
  const stroke = obj as StrokeSnap;

  // The path in the box's own units: origin at the box's top-left, which is what the viewBox
  // below declares. Read once per render; there is nothing here to remember.
  const local = scaledPoints(stroke);
  if (local.length === 0) return null; // a box with no line in it is not a drawing
  const d = smoothPath(local);
  const nib = strokeThickness(stroke);

  return (
    <div
      role="img"
      aria-label="Drawing"
      data-object-type="stroke"
      data-object-id={stroke.id}
      data-stroke-color={stroke.color}
      data-stroke-thickness={stroke.thickness}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`stroke-${stroke.id}`}
      tabIndex={0}
      className="board-object stroke-object"
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        zIndex: stroke.z,
        // The box is not a target: see 1 above. The line inside it is, and says so itself.
        pointerEvents: 'none',
      }}
      // A stroke has no text to edit, and a double-click that reached the board would otherwise
      // create a sticky note on top of it.
      onDoubleClick={(e) => e.stopPropagation()}
      // Both paths below bubble their presses here: one handler for the line, wherever on it the
      // press landed, which is also how the press keeps its id under a stroke whose `z` changed.
      onPointerDown={(e) => {
        e.stopPropagation();
        onObjectPointerDown(e, stroke.id);
      }}
    >
      <svg
        data-testid={`stroke-svg-${stroke.id}`}
        data-stroke-id={stroke.id}
        data-stroke-width={stroke.width}
        data-stroke-height={stroke.height}
        aria-hidden="true"
        width={stroke.width}
        height={stroke.height}
        viewBox={`0 0 ${stroke.width} ${stroke.height}`}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          display: 'block',
        }}
      >
        {/* The invisible wide line a press is caught by, painted first so the visible ink sits on
            top of it. `stroke="transparent"` rather than `opacity: 0`, because an element painted
            with zero opacity is not painted at all and `pointer-events: stroke` follows the
            paint. */}
        <path
          data-testid={`stroke-hit-${stroke.id}`}
          data-stroke-hit="true"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth(nib, zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
        />
        {/* The stroke itself: round caps and round joins, so a dot is a dot and a sharp turn is
            not notched. */}
        <path
          data-testid={`stroke-line-${stroke.id}`}
          data-stroke-line="true"
          d={d}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={nib}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
        />
      </svg>
    </div>
  );
}
