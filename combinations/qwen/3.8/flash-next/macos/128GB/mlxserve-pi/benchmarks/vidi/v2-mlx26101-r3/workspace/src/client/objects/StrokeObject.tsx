import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import { asStrokeSnapshot, scaledPoints, strokeHitTolerance } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';
import type { ObjectProps } from './registry';

/**
 * Story 11's props of a stroke. The design's `{ stroke, selected }` is what this draws from, and both
 * are here: `selected` because the board hands it, and `stroke` because the object loop hands the one
 * props list every type gets, so the stroke is taken out of it by the stroke's own reader.
 */
export type StrokeObjectProps = ObjectProps;

/**
 * A point in the stroke's own drawing space: board units, measured from the corner its box starts at.
 *
 * The stored path is already relative to that corner — which is the whole trick of a stroke that can be
 * dragged without rewriting five thousand numbers — but it is relative to the *stored* corner, and what
 * is on screen is the box scaled by `width / baseWidth`. {@link scaledPoints} does that arithmetic and
 * hands back board points; this takes the corner back off so the drawing can be placed at the corner of
 * the `<svg>` rather than at a coordinate that happens to be somewhere else on the board.
 */
function local(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

/**
 * A stroke: one line, drawn as the path that was captured.
 *
 * Two numbers decide what is drawn, and both are read rather than stored: the *path*, which is the
 * stored points scaled into whatever box the stroke is in now, and the *width*, which is the stored
 * thickness and is never scaled. That pair is what "a stroke resizes in proportion" means in the
 * drawing — a corner handle dragged to twice the size makes a drawing twice as long and no thicker,
 * because the box is the thing that was resized and the pen that made the line is not part of it.
 *
 * The line is drawn with midpoint quadratic curves through the stored points ({@link smoothPath}) rather
 * than straight segments, because a captured path is a few hundred samples of a hand and straight
 * segments between samples draw the jitter as a jagged edge. The curves stay within a noise-step of every
 * point, so the drawing is the drawing that was simplified, to within the pixel it was simplified to.
 *
 * Under it is an invisible line of the hit tolerance, and that is where a click on a stroke is decided —
 * see the registry's hit test, which asks the same question of the same points.
 */
export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const { object, zoom, selected, onObjectPointerDown } = props;
  const stroke = asStrokeSnapshot(object);

  if (stroke === null) {
    // Not a stroke, or a stroke this client cannot draw — one whose path is missing, so there is no line
    // to draw and no default line to draw instead. The board skips objects of unknown types; this is the
    // same answer from the inside.
    return <></>;
  }

  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  // Room for the invisible line, in board units: the hit line is wider than the drawing, and at the ends
  // of a stroke it hangs outside the box. Clipped to the box it would be a stroke that cannot be clicked
  // at either end, which is where a person aims when they mean to pick one up.
  const tolerance = strokeHitTolerance(stroke, zoom);
  const pad = tolerance * 2;

  // Board points, scaled into the box as it is now. Everything below is a function of these: the same
  // call the hit test makes, so the drawn line and the clickable line are the same line by construction.
  const world = scaledPoints(stroke);
  const origin = { x: object.x - pad, y: object.y - pad };
  const path = smoothPath(world.map((point) => local(point, origin)));

  const onHitPointerDown = (event: ReactPointerEvent<SVGPathElement>): void => {
    // The stroke is what was pressed, not the note underneath it: a press on the line picks it up rather
    // than falling through to the board, the same way an arrow's line takes the press for itself.
    event.stopPropagation();
    onObjectPointerDown(event, object.id);
  };

  return (
    <div
      className="stroke-object"
      data-stroke-object=""
      data-testid="stroke-object"
      data-object-id={object.id}
      data-object-type={object.type}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-points={stroke.points.length}
      data-selected={selected ? 'true' : 'false'}
      style={{
        left: `${origin.x}px`,
        top: `${origin.y}px`,
        width: `${object.width + pad * 2}px`,
        height: `${object.height + pad * 2}px`,
      }}
      role="img"
      aria-label="Drawing"
    >
      <svg
        className="stroke-object__svg"
        width={object.width + pad * 2}
        height={object.height + pad * 2}
        aria-hidden="true"
      >
        {/* The clickable line first: it is under the drawing, so what a person sees is what is on top. */}
        <path
          className="stroke-object__hit"
          data-testid="stroke-hit"
          d={path}
          fill="none"
          // Half the line each side of the path, so this is `tolerance` units either side of it — the
          // registry's rule, drawn. See `strokeHitTolerance`.
          strokeWidth={tolerance * 2}
          onPointerDown={onHitPointerDown}
        />
        <path
          className="stroke-object__line"
          data-testid="stroke-line"
          d={path}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={thickness}
        />
      </svg>
    </div>
  );
}
