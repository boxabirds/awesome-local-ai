/**
 * A stroke on the board (`pen.select`): the line somebody drew, and nothing else.
 *
 * It is drawn from `scaledPoints`, which is the one place the stored line meets the box it now
 * has: the points are kept as they were created and multiplied by `width / baseWidth`, so
 * resizing a stroke scales the drawing rather than re-recording it, and the line that comes out is
 * in proportion whatever was dragged (`pen.resize`).
 *
 * Three rules of its own, all of them about the fact that a stroke's box is mostly nothing:
 *
 *  - **it is clicked near its line.** A scribble round four sticky notes has a bounding rectangle
 *    that covers them all, and a type that answered to clicks inside that rectangle would make the
 *    notes underneath impossible to reach. So the surface is a stroke of
 *    `STROKE_HIT_TOLERANCE_PX` *screen pixels* wide — or the line's own thickness, whichever is
 *    bigger — and the rest of the box is transparent to the pointer, which falls through to the
 *    object below, or to the board (`pen.select`, TC-16);
 *  - **its thickness is a board measurement.** Two board units at 100% is two at 200%, so a
 *    stroke is the same drawing on every screen and under every zoom, and resizing one by dragging
 *    a handle scales the *shape* while the pen that drew it stays the same pen;
 *  - **being selected does not change its colour.** A note goes blue-edged and a shape takes on
 *    the selection colour, because those are things the board colours. A stroke is the user's ink:
 *    saying "selected" with the selection box and not with the line is the difference between
 *    showing somebody their drawing and showing them a highlighted drawing.
 */

import { useCallback, useRef, type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { smoothPath } from '../../shared/geometry/simplify';
import { penThicknessWorld, scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { screenToWorld } from '../canvas/camera';
import type { ObjectComponentProps } from './registry';

/**
 * Is `world` on this stroke?
 *
 * Within `STROKE_HIT_TOLERANCE_PX` *screen* pixels of the line, or within half its thickness when
 * the line is thicker than that — "within 6 pixels, or within half its thickness, whichever is
 * larger" (`pen.select`), turned into board units by the zoom. A thick marker line is as easy to
 * hit as it is to see; a hairline still gets a target a person can aim at.
 */
export function strokeHitTest(object: ObjectSnapshot, world: Point, zoom = 1): boolean {
  const stroke = object as StrokeSnap;
  if (!stroke || !world) return false;
  const tolerance = Math.max(penThicknessWorld(stroke.thickness) / 2, STROKE_HIT_TOLERANCE_PX / (zoom || 1));
  return distanceToPolyline(scaledPoints(stroke), world) <= tolerance;
}

export function StrokeObject(props: ObjectComponentProps): JSX.Element {
  const stroke = props.object as StrokeSnap;
  const zoom = props.zoom || 1;
  // The line where the box says it should be. A stroke nobody has resized scales by exactly one.
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const width = Math.max(stroke.width, 1);
  const height = Math.max(stroke.height, 1);
  const thicknessWorld = PEN_THICKNESS_WORLD[stroke.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const color = PEN_COLORS[stroke.color] ?? PEN_COLORS.black;

  // The handler is created once and reads the current props through a ref, so a press in the
  // middle of a remote change acts on the stroke and the camera as they are now.
  const latest = useRef(props);
  latest.current = props;

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = latest.current;
    const world = screenToWorld(current.camera, { x: event.clientX, y: event.clientY });
    // The pointer has to be near the line. In a browser it already is — the transparent stroke is
    // the only part of this element that answers to the pointer — and the same test is made here
    // so the rule is one rule, measured once, rather than a stylesheet's idea of one.
    if (!strokeHitTest(current.object, world, current.zoom || 1)) return;
    if (current.transforming) return;
    current.gesture.onObjectPointerDown(event, current.object.id);
  }, []);

  const boxStyle: CSSProperties = {
    left: stroke.x,
    top: stroke.y,
    width,
    height,
    // The box is a frame around a line, not a surface: only the stroke answers to the pointer.
    pointerEvents: 'none'
  };

  return (
    <div
      className="vidi6-stroke"
      data-vidi6="stroke"
      data-object-id={stroke.id}
      data-object-type={stroke.type}
      data-stroke-id={stroke.id}
      data-x={stroke.x}
      data-y={stroke.y}
      data-width={stroke.width}
      data-height={stroke.height}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-selected={props.selected ? 'true' : 'false'}
      role="img"
      aria-label="Drawing"
      style={boxStyle}
      onPointerDown={handlePointerDown}
    >
      {/* The viewBox is the box in board units, like every other object's, so a board measurement
          stays a board measurement however far the camera has gone. */}
      <svg
        className="vidi6-stroke-svg"
        data-testid="stroke-svg"
        width={width}
        height={height}
        viewBox={`${stroke.x} ${stroke.y} ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* The clickable surface: as wide as the hit test, so what a person aims at and what the
            board accepts are one width. */}
        <path
          className="vidi6-stroke-hit"
          data-vidi6="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(thicknessWorld, (STROKE_HIT_TOLERANCE_PX / zoom) * 2)}
          style={{ pointerEvents: 'stroke' }}
        />
        <path
          className="vidi6-stroke-line"
          data-vidi6="stroke-line"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thicknessWorld}
          // Said here as well as in the stylesheet: a round nib is what drew this line, and a dot
          // with a butt cap is not a dot but nothing at all (`pen.dot`).
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
