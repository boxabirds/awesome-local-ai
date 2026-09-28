// A line somebody drew with the pen (story 11, stroke.object).
//
// What makes a stroke unlike a sticky note is that its box is not its shape: the
// box is what story 7's selection, marquee, resize and delete machinery acts on,
// and the DRAWING is the path inside it, scaled to whatever the box has become. So
// this component never draws stored coordinates directly - it asks the stroke model
// where the recorded points are now (`scaledPoints`, which multiplies them by how
// much the box has been stretched since they were recorded) and draws those. Resize
// a stroke and this re-renders from the new box; the pen that drew it is not involved.
//
// The other thing that matters is what does NOT get clicked. A stroke's box is most-
// ly empty space, and a click in it must reach whatever is underneath - the note this
// sketch annotates. So the box itself takes no pointer events, and only a band along
// the line does, exactly as wide as the distance the registry's hit test accepts: what
// you can hit with a mouse is what the board says is there.
import type React from 'react';
import { scaledPoints, isStrokeSnapshot } from '../../shared/objects/stroke.ts';
import { smoothPath } from '../../shared/geometry/simplify.ts';
import type { Point } from '../../shared/geometry.ts';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config.ts';
import type { ObjectProps } from './registry.tsx';

const SELECTION_COLOR = '#2563eb';

/** A world distance converted to what it is on screen at this zoom. */
const toScreen = (world: number, zoom: number): number => world / (zoom > 0 ? zoom : 1);

export function StrokeObject(props: ObjectProps): React.JSX.Element {
  const { obj, zoom, selected, editable, onObjectPointerDown } = props;
  const stroke = isStrokeSnapshot(obj) ? obj : null;

  // Where the drawing is now, in world units - and how far from the line a click
  // still counts as a click ON it, in world units at this zoom.
  const points = stroke ? scaledPoints(stroke) : [];
  const thicknessWorld = stroke ? PEN_THICKNESS_WORLD[stroke.thickness] : PEN_THICKNESS_WORLD.medium;
  const zoomSafe = zoom > 0 ? zoom : 1;
  const toleranceWorld = Math.max(thicknessWorld / 2, toScreen(STROKE_HIT_TOLERANCE_PX, zoomSafe));

  if (!stroke || points.length === 0) {
    // Not a stroke, or a path this build cannot read: draw nothing, but draw it
    // safely - one broken object must never take the board down with it.
    return (
      <div
        data-testid={`stroke-${obj.id}`}
        data-object-id={obj.id}
        data-broken="true"
        style={{ position: 'absolute', left: obj.x, top: obj.y, width: 0, height: 0, pointerEvents: 'none' }}
      />
    );
  }

  const d = smoothPath(points);
  // The graphic's frame is the object's box with room around it for the clickable
  // band, so a stroke that is a perfectly straight line - whose box is as tall as
  // its own thickness - is still drawn, and still hit, at its ends.
  const pad = toleranceWorld + thicknessWorld;
  const minX = obj.x - pad;
  const minY = obj.y - pad;
  const width = (obj.width ?? 0) + pad * 2;
  const height = (obj.height ?? 0) + pad * 2;

  // The middle of the line, as a point that is definitely on it: what a click that
  // is far from the line has to miss for the box to fall through (see TC-16).
  const onLine: Point = points[Math.floor(points.length / 2)];

  const onLineDown = (e: React.PointerEvent<SVGPathElement>) => {
    if (e.button !== 0) return;
    if (!editable) return; // a board that cannot be edited still draws over its notes
    e.stopPropagation();
    onObjectPointerDown(e, obj.id);
  };

  return (
    <div
      role="group"
      aria-label="Drawing"
      data-testid={`stroke-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected}
      data-editable={editable}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-points={points.length}
      // The box the MODEL holds, stated here because the frame around it is bigger
      // on purpose: tests and anything else that asks read the object from here.
      data-world-x={obj.x}
      data-world-y={obj.y}
      data-world-width={obj.width}
      data-world-height={obj.height}
      data-on-line-x={onLine.x}
      data-on-line-y={onLine.y}
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width,
        height,
        // The frame is only a frame: everything clickable is drawn inside it, so a
        // sketch laid across a note never steals that note's clicks.
        pointerEvents: 'none',
        touchAction: 'none',
      }}
    >
      <svg
        data-testid={`stroke-graphic-${obj.id}`}
        width={width}
        height={height}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block' }}
        aria-hidden="true"
      >
        {/* The band a click lands on, drawn transparently under the line and exactly
            as wide as the hit test's tolerance - 6 px of screen, or half the line's
            own weight where the line is thicker than that. It is measured in WORLD
            units divided by the zoom rather than with `vector-effect: non-scaling-
            stroke` for the reason story 10 found the hard way: Chrome hit-tests the
            SCALED stroke, so a screen-constant stroke would be clickable 12 px from
            the line at 200% while the model still said 6, and the two would disagree
            about what a click near a drawing means. */}
        <path
          data-testid={`stroke-hit-${obj.id}`}
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={toleranceWorld * 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: editable ? 'pointer' : 'default' }}
          onPointerDown={onLineDown}
        />

        {/* The line itself: round caps and joins, because a pen stroke that ends in a
            square is a drawing with sawn-off ends. Its weight is in WORLD units, so it
            grows with the board when you zoom - which is what a drawing is. */}
        <path
          data-testid={`stroke-path-${obj.id}`}
          d={d}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={thicknessWorld}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-world-thickness={thicknessWorld}
        />

        {selected ? (
          // The selected drawing wears its own outline, not a box: a box around
          // mostly nothing would say "the rectangle is the thing", and it is not.
          <path
            data-testid={`stroke-selection-${obj.id}`}
            d={d}
            fill="none"
            stroke={SELECTION_COLOR}
            strokeWidth={thicknessWorld + toScreen(6, zoomSafe)}
            strokeOpacity={0.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </div>
  );
}
