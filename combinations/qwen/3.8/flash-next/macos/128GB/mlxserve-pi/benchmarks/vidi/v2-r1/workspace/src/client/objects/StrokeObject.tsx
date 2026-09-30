// A drawing, drawn the same way on every screen (`stroke.object`, `pen.share`).
//
// A stroke is the one object on the board that is not a box with something in it: what is
// stored is a path, and the box is only where the path lives. So this component does two
// things and nothing else:
//
//   - **It paints the path.** `scaledPoints` puts the stored points at the object's current
//     size, `smoothPath` turns them into quadratic curves that lean towards each sample
//     instead of turning at it, and the result is one `<path>` in world units — the same
//     string on every screen that holds the same stroke, which is what makes a shared
//     sketch look the same to both people (`pen.share`).
//
//   - **It is clicked by its line, not by its box.** A stroke's box is mostly empty air: an
//     underline four units thick has a box hundreds of units wide, and a click in that air
//     that is nowhere near the ink must reach whatever is behind it (TC-16). So the pointer
//     target is a second, invisible path as wide as twice the hit tolerance in board units —
//     six *screen* pixels' worth at this zoom, or half the line's own thickness if the line
//     is thicker — which is exactly the distance `hitTestStroke` says a click had to be
//     within. The rule and the target are the same number, so the browser's own hit testing
//     cannot disagree with the function the tests check (`pen.select`). That is the same
//     trick `ConnectorObject` plays with its transparent polyline.
//
// What is *not* here: no pointer logic beyond the press, no writing, no drag. Moving,
// resizing and deleting a stroke are story 7's generic transforms reached through the
// registry — `aspectLocked: true` is what makes a resize keep the drawing's proportions
// (`pen.resize`), and the handles that do it are the selection's, not this component's.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (stroke.object)
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { objectBounds } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { smoothPath } from '../../shared/geometry/simplify';
import {
  scaledPoints,
  strokeColorCss,
  strokeHitWidthWorld,
  strokeThicknessWorld,
  type StrokeSnapshot,
} from '../../shared/objects/stroke';

export interface StrokeObjectProps {
  /** The stroke, as the document holds it — local or somebody else's, read the same way. */
  stroke: StrokeSnapshot;
  selected: boolean;
  /**
   * The board's zoom. The design's contract lists two props and these are the other two it
   * needs: the line is drawn in board units and is *clicked* in screen pixels, and only the
   * viewport knows how big a pixel is right now.
   */
  zoom: number;
  /** False on a board this screen cannot write to: nothing here is clickable. */
  editable: boolean;
  /** The generic press, so a stroke is selected the way anything else is. */
  onObjectPointerDown(event: PointerEvent, id: string): void;
}

/** What a stroke is called to a screen reader: a drawing, which is what it is. */
export const STROKE_ARIA_LABEL = 'Drawing';

export function StrokeObject({
  stroke,
  selected,
  zoom,
  editable,
  onObjectPointerDown,
}: StrokeObjectProps): ReactNode {
  const box = objectBounds(stroke);
  const points = scaledPoints(stroke);
  const path = smoothPath(points);
  const thickness = strokeThicknessWorld(stroke.thickness);

  const onPointerDown = (event: ReactPointerEvent<SVGPathElement>): void => {
    if (!editable || event.button !== 0) return;
    // The board underneath does not pan, and the objects behind are not clicked.
    event.stopPropagation();
    // And the default action is cancelled, which is the part a shape does not need.
    // Firefox treats an `<svg>` as a picture it can drag: press a drawing, move a few
    // pixels, and it fires `dragstart` and then `pointercancel` for the pointer, so the
    // gesture sees a cancelled pointer and the drawing never moves. Cancelling the press
    // is what says the page, not the browser, owns this pointer. (`draggable={false}` on
    // the `<svg>` reads like the documented answer and does nothing here.)
    //
    // No `setPointerCapture` either, unlike a shape or a connector: the one gesture that
    // moves this drawing already listens for `pointermove`, `pointerup` and
    // `pointercancel` on `window`, so capture buys nothing — and on Firefox it added a
    // `lostpointercapture` to the same cancelled stream.
    event.preventDefault();
    onObjectPointerDown(event.nativeEvent, stroke.id);
  };

  return (
    <div
      data-testid="stroke-object"
      data-id={stroke.id}
      data-selected={selected ? 'true' : 'false'}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      style={boxStyle(box)}
    >
      <svg
        data-testid="stroke-object-svg"
        style={svgStyle}
        width={box.width}
        height={box.height}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        focusable="false"
        role="img"
        aria-label={STROKE_ARIA_LABEL}
      >
        {/* The target first, and invisible: as wide as the tolerance, so the only clicks
            that can land here are the ones the model would call a hit. */}
        <path
          data-testid="stroke-hit"
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={strokeHitWidthWorld(stroke.thickness, zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={onPointerDown}
        />
        <path
          data-testid="stroke-path"
          d={path}
          fill="none"
          stroke={strokeColorCss(stroke.color)}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** The box a stroke is drawn in: the one the document holds, unchanged. */
const boxStyle = (box: Rect): CSSProperties => ({
  position: 'absolute',
  left: box.x,
  top: box.y,
  width: box.width,
  height: box.height,
  // A curve bulges a little outside the samples it was drawn through, and the box is the
  // samples'; clipping a drawing at its own box would cut the drawing.
  overflow: 'visible',
  // The box is not the drawing: only the target path takes the pointer.
  pointerEvents: 'none',
});

const svgStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  display: 'block',
  overflow: 'visible',
  pointerEvents: 'none',
};
