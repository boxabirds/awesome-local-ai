/**
 * One drawing on the board (story 11).
 *
 * A stroke is the simplest object on this board to draw and the hardest one to click. Drawing it is a
 * `d` attribute: the points the model puts back where the object is and at the size the object is
 * (`scaledPoints`), smoothed into a curve by the same function that drew the preview while the pen was
 * down — which is the whole reason a finished stroke does not visibly change when the pen lifts. The
 * preview and the object are the same arithmetic on the same line.
 *
 * Clicking it is the interesting half. A stroke's bounding box is the box around a squiggle, and most of
 * the box is not the squiggle: a circle drawn round three sticky notes has a box that covers those notes
 * and a great deal of air between them. Were that box the object's presence to the pointer, clicking a note
 * inside somebody's annotation would select the annotation instead of the note, and the board would feel
 * as though it had grown an invisible floor over the drawing. So the box is transparent and only the line
 * itself catches the pointer — one invisible stroke over the visible one, as wide as the hit rule the
 * registry uses, and this is the same three-layer arrangement story 10 built for an arrow for exactly this
 * reason.
 *
 * The three layers, from the outside in:
 * — a box, transparent to the pointer, which is where the object is as far as selection rectangles, resize
 *   handles and the marquee are concerned;
 * — the drawing, in the colour it was drawn in and the thickness it was drawn with;
 * — an invisible stroke over it, and the only part a pointer can hold.
 *
 * The line is drawn in world units inside a world layer that the board scales, so `stroke-width` here is
 * the pen's world width and nothing else: a stroke that has been dragged twice as big is drawn from the same
 * points and the same width, which is how a sketch that grew is the same sketch drawn with the same pen.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';

import { PEN_THICKNESS_WORLD, type PenThickness } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, strokeColorOf, strokeHitRadius, type StrokeSnapshot } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

/** The registry key of a drawing, and the value of its `type` field — the model's own, re-exported. */
export { STROKE_OBJECT_TYPE } from '../../shared/objects/stroke';

/**
 * How wide the invisible stroke a pointer can catch is, in world units, at this zoom.
 *
 * Twice the radius the registry asks the same question with, so that the line a person can click is exactly
 * as wide as the line the board will select — the click and the answer to "what is under it" cannot
 * disagree, which is the property story 10's arrows rest on and the one a drawing needs identically. The
 * radius already carries the zoom: six screen pixels are six screen pixels at any scale, and six of them
 * are twelve world units at 50 %.
 */
export const strokeHitWidth = (stroke: StrokeSnapshot, zoom: number): number => strokeHitRadius(stroke, zoom) * 2;

/** How thick the ink is, in world units: the pen's width, and not the object's. */
export const strokeWidthWorld = (thickness: PenThickness): number => PEN_THICKNESS_WORLD[thickness];

/** What it says out loud. A drawing has no text and no shape a person named, so it is what it is. */
export const strokeAriaLabel = (): string => 'Drawing';

/** A number the document holds, or the number a drawing that cannot be drawn should fall back to. */
const numberOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The points inside the object's own box, which is what an SVG is drawn in.
 *
 * `scaledPoints` answers where the line is on the board; the path is drawn in a box positioned at the
 * object's corner, so the box's corner is taken off again. Nothing is cached between renders: a stroke
 * follows its own box while it is dragged, one frame at a time, and a copy kept for speed would be a
 * drawing left behind by the pointer that moved it.
 */
const localPoints = (stroke: StrokeSnapshot, box: Point): Point[] =>
  scaledPoints(stroke).map((point) => ({ x: point.x - box.x, y: point.y - box.y }));

export function StrokeObject(props: ObjectProps<StrokeSnapshot>): React.JSX.Element | null {
  const { obj, selected, zoom, editing } = props;

  const box = {
    x: numberOr(obj.x, Number.NaN),
    y: numberOr(obj.y, Number.NaN),
    width: Math.max(numberOr(obj.width, 0), 0),
    height: Math.max(numberOr(obj.height, 0), 0),
  };
  // A drawing with no position is a drawing that cannot be drawn. The one case this is written for is a
  // document from a client that wrote numbers this one cannot read, and the answer to that is to draw
  // nothing rather than to throw and take the board down with the drawing.
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;

  const points = localPoints(obj, box);
  // A line of no points at all is a `d` of nothing, which an SVG draws as nothing; it is still an object,
  // still selectable by nothing and still listed, because the document says it is there.
  const d = smoothPath(points);
  const width = strokeWidthWorld(obj.thickness);

  /**
   * A press on the line: the drawing is selected, and then whatever the board does with a pressed object.
   *
   * Stopped where it stands, so the board does not read the press as a press on the air over the board —
   * a pan, and a selection dropped. Everything after that is story 7's: a stroke is an ordinary object once
   * it exists, so a drag of it is the group-move gesture and a drag of its corner is a resize, and neither
   * is this component's business.
   */
  const onLinePointerDown = (event: ReactPointerEvent<SVGPathElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (editing) return; // there is nothing to type into, but a press inside an object being edited edits
    props.onObjectPointerDown(event, obj.id);
  };

  return (
    <div
      aria-label={strokeAriaLabel()}
      className="stroke-object"
      data-color={obj.color}
      data-color-value={strokeColorOf(obj.color)}
      data-height={box.height}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-testid="stroke-object"
      data-thickness={obj.thickness}
      data-width={box.width}
      data-x={box.x}
      data-y={box.y}
      data-z={obj.z}
      role="img"
      style={
        {
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          // The box is nothing; the line inside it is something. See the note at the top of this file.
          pointerEvents: 'none',
        } as React.CSSProperties
      }
    >
      <svg
        className="stroke-object-svg"
        data-testid="stroke-object-svg"
        height={box.height}
        style={{ overflow: 'visible', display: 'block' } as React.CSSProperties}
        width={box.width}
      >
        <path
          className="stroke-line"
          d={d}
          data-digits={points.length}
          data-stroke-width={width}
          data-testid="stroke-line"
          fill="none"
          // Round, at both ends and at every corner: the caps are what make a one-point stroke a dot rather
          // than nothing, and a join that mitres turns a slow hand into a spike.
          strokeLinecap="round"
          strokeLinejoin="round"
          stroke={strokeColorOf(obj.color)}
          strokeWidth={width}
        />
        {d === '' ? null : (
          <path
            className="stroke-hit"
            d={d}
            data-stroke-width={strokeHitWidth(obj, zoom)}
            data-testid="stroke-hit"
            // The same line again, invisible and wide, and the only part of the drawing a pointer can catch
            // hold of. `stroke` rather than `all`: the inside of a curve is not the curve, and a circle
            // drawn round three notes must leave those three notes clickable.
            fill="none"
            onPointerDown={onLinePointerDown}
            pointerEvents="stroke"
            stroke="transparent"
            strokeWidth={strokeHitWidth(obj, zoom)}
          />
        )}
      </svg>
    </div>
  );
}
