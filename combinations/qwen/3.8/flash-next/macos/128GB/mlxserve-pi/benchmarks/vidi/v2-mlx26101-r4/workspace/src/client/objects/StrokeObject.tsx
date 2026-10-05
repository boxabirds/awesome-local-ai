/**
 * One drawing on the board: a line the pen laid down, and the only thing about it that is a line.
 *
 * A stroke is the fourth object type and the first whose whole shape is a *path*. A sticky note is a rectangle
 * with words in it and a shape is a rectangle drawn as a diamond, so both of them can be a `div` and be
 * finished; this is a polyline of up to five thousand points, which is not a thing CSS can be asked to draw, so
 * it is an SVG `path` — and the one difference this makes to the board is worth naming in a file that otherwise
 * looks like the other three.
 *
 * **The picture is a consequence, never a copy.** The points in the document are the ones the pen made, stored
 * inside the box the drawing was drawn in; where they are *now* is asked of `scaledPoints`, which multiplies
 * them by however big that box has become. So a resize writes four numbers about the box and every point on
 * five screens moves with it — nothing is rewritten, and a drawing being resized by one person while four
 * others watch is not a fight between two sets of five thousand numbers. It is also why the line keeps the
 * thickness it was drawn with when the drawing is made larger (`pen.resize`): the box scales, the nib does not.
 *
 * **The drawing does not stop the pointer, except where the drawing is.** The wrapper is transparent to the
 * pointer and only the strokes of the path can be pressed. That is the whole of how a click inside a drawing's
 * bounding box but far from its line falls through to the note underneath (`pen.select`) — a bounding box is a
 * rectangle somebody would have to be able to see to make sense of, and this drawing occupies a line inside a
 * rectangle that is not shown. The invisible press-target is as wide as a pointer's tolerance, so a stroke is as
 * easy to click at ten per cent as at four hundred, exactly as an arrow is.
 *
 * **Nothing is stored about how it looks.** The colour and the nib are names, and the hex and the width come out
 * of the settings on every draw — so a stroke drawn last week by a build that has since changed the purple is
 * drawn in this week's purple, and a board written by a build that added a seventh ink still shows that stroke,
 * in the default ink rather than in nothing.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { isStrokeSnapshot, readStroke, scaledPoints, strokePenWidth } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { ObjectProps } from './objectProps';

export type StrokeObjectProps = ObjectProps;

/** The mouse button that picks a drawing up. */
const PRIMARY_MOUSE_BUTTON = 0;

/** What the board says this object is, to somebody who cannot see it. */
export const STROKE_ARIA_LABEL = 'Drawing';

export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const { object, doc, zoom, selected, readOnly, interaction } = props;
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  // The board hands every object the generic snapshot, which carries a stroke's fields as soon as this type is
  // registered — and a component that had to read the document to draw itself would read the whole board once
  // per frame of every drag. So the snapshot is used when it says it is a stroke, and only a snapshot that
  // cannot be (a record whose drawing this build cannot read, a component drawn outside a board) goes and asks
  // its own document. Both answers are the same answer to within the rounding the record keeps.
  const stroke = isStrokeSnapshot(object) ? object : readStroke(doc, object.id);

  if (stroke === null) {
    // A stroke with no drawing in it is drawn as nothing rather than as a guess, and it is still an element in
    // the tree so that the object exists, occupies its place in the stacking order and can be deleted. There is
    // no message: a record this build cannot read belongs to a build that can, and the board will not be
    // showing it either way.
    return (
      <div
        className="stroke-object"
        data-testid="stroke-object"
        data-stroke-id={object.id}
        data-drawing="unreadable"
        style={{ left: object.x, top: object.y, width: 0, height: 0, zIndex: object.z }}
      />
    );
  }

  // Where the drawing is now, and how it is drawn. Both are read from the record on every render, which is what
  // makes a remote stroke look the same as a local one the moment the record arrives: there is no second path
  // from the pen to the screen, so there is nothing that can be out of date.
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const nib = strokePenWidth(stroke);

  // The press-target is a pointer's width on either side of the line, in *screen* pixels turned into board
  // units — the same rule, at the same distance, as an arrow's, because a pointer that can hit an arrow ought
  // to be able to hit a stroke. The number is the registry's `hitTest` with the arithmetic done the other way
  // round: a band this wide centred on the line reaches exactly `max(half the nib, six pixels)` from it, so the
  // picture, the press and the marquee cannot disagree about where the drawing is. The wrapper is padded by the
  // same amount plus the paint, so a target is never clipped by the edge of the picture — which is what a thin
  // drawing at a low zoom would otherwise be: invisible to the pointer on exactly the side where the line is.
  const band = Math.max(nib / 2, STROKE_HIT_TOLERANCE_PX / scale);
  const reach = band + nib / 2;
  const origin = { x: stroke.x - reach, y: stroke.y - reach };
  const size = { width: stroke.width + reach * 2, height: stroke.height + reach * 2 };

  const press = (event: ReactPointerEvent<SVGPathElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    // A board that cannot be written to still lets a drawing be looked at, and looking at it does not select it.
    if (readOnly) {
      event.stopPropagation();
      return;
    }
    // The press is this drawing's: the note underneath is not pressed, and the board does not pan.
    event.stopPropagation();
    props.onPointerDown(event as unknown as ReactPointerEvent<HTMLElement>, stroke.id);
  };

  return (
    <div
      className="stroke-object"
      role="img"
      aria-label={STROKE_ARIA_LABEL}
      data-testid="stroke-object"
      data-stroke-id={stroke.id}
      data-stroke-color={stroke.color}
      data-stroke-thickness={stroke.thickness}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      style={{
        left: origin.x,
        top: origin.y,
        width: size.width,
        height: size.height,
        zIndex: stroke.z,
        // Only the lines of the path are pressable; the box around them is a bounding box, and a rectangle
        // that catches clicks nobody aimed at would put an invisible wall over the note underneath.
        pointerEvents: 'none',
      }}
    >
      <svg
        className="stroke-object__svg"
        data-testid="stroke-svg"
        width={size.width}
        height={size.height}
        viewBox={`${origin.x} ${origin.y} ${size.width} ${size.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* Where a click is aimed: the same curve, drawn wide and unpainted, answering to the pointer only on
            its stroke. Drawn first so the visible line stays on top of it. */}
        <path
          data-testid="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={band * 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: readOnly ? undefined : 'move' }}
          onPointerDown={press}
        />
        <path
          data-testid="stroke-path"
          d={d}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={PEN_THICKNESS_WORLD[stroke.thickness]}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  );
}
