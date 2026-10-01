// One freehand stroke on the board (story 11): the line a Pen drag drew.
//
// What makes a stroke different from every other object here is that it is not a
// box. It has a box like anything else - it is moved, resized, deleted, raised and
// selected by story 7's rules through it - but the box is only the room the drawing
// was made in. The drawing itself is a polyline stored relative to that box's origin,
// and `scaledPoints` puts it back where it now belongs: a stroke dragged twice as
// wide is the same drawing twice as big, drawn at the thickness it was drawn with.
//
// So the line is what a pointer is measured against, never the box. A click inside
// the box and far from the line is a click on the board, or on the sticky note
// underneath - which is what lets somebody scribble across a whole cluster of notes
// and still click the notes they wrote between the lines. The invisible path drawn
// here for that is exactly as wide as the click tolerance, and it is the only part of
// this box that takes a pointer at all.
//
// A stroke holds no words, so it opens no editor: double-clicking it stops the board
// dropping a sticky note on top of it and asks for nothing else.

import {
  useMemo,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnapshot } from '../../shared/objects/stroke';
import type { StickyNoteProps } from './StickyNote';

/**
 * A stroke takes the props every object takes and names its own snapshot in `note`
 * (the design's `stroke`). It edits no text and needs no document to read one from,
 * so it asks for none of the edit callbacks: what it uses is the snapshot, the zoom,
 * the selection flags and the board's transform gesture.
 */
export type StrokeObjectProps = Omit<
  StickyNoteProps,
  'note' | 'doc' | 'single' | 'editing' | 'onStartEdit' | 'onFocusNote' | 'onEndEdit'
> & {
  note: StrokeSnapshot;
};

export function StrokeObject({
  note,
  zoom,
  selected,
  editable,
  dragging = false,
  onGesturePointerDown,
  onSelect,
}: StrokeObjectProps): JSX.Element {
  // The drawing, in board units, as it stands now: the stored numbers scaled by
  // however much the box has grown since the line was drawn. Recomputed whenever the
  // snapshot is, which is whenever anything on the board changed - including this
  // stroke being resized by a handle, which is what makes a resize redraw live.
  const points = useMemo(() => scaledPoints(note), [note]);
  const d = useMemo(() => smoothPath(points), [points]);

  /** The ink's own width, in board units: stored, so a resize never thickens it. */
  const thickness = PEN_THICKNESS_WORLD[note.thickness];
  /**
   * How wide the invisible path a pointer can hit is: the ink, or six screen pixels
   * converted to board units at this zoom, whichever is wider - so a thin line is
   * still clickable, and a thick one is clickable across all of it.
   */
  const clickable = Math.max(thickness, (STROKE_HIT_TOLERANCE_PX / zoom) * 2);

  /** The press is on the ink: the board neither pans nor deselects. */
  const onPointerDown = (event: ReactPointerEvent<SVGPathElement>): void => {
    if (!editable) return; // a board that could not be read takes no gestures at all
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    if (onGesturePointerDown !== undefined) {
      // the board's transform gesture takes the press: it moves the whole selection
      // and keeps its own state about what was grabbed. The stroke's hit path is an
      // SVG path, and the gesture is given the same press a note's div hands it.
      onGesturePointerDown(event as unknown as ReactPointerEvent<HTMLDivElement>);
      return;
    }
    onSelect(note.id);
  };

  /** A double-click on the line is the drawing's, not the board's new sticky note. */
  const onDoubleClick = (event: ReactMouseEvent<SVGPathElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className={`stroke-object${dragging ? ' is-dragging' : ''}`}
      data-testid="stroke-object"
      data-stroke-id={note.id}
      data-stroke-x={note.x}
      data-stroke-y={note.y}
      data-stroke-width={note.width}
      data-stroke-height={note.height}
      data-stroke-z={note.z}
      data-color={note.color}
      data-thickness={note.thickness}
      data-points={points.length}
      data-selected={selected}
      data-editable={editable}
      data-dragging={dragging}
      role="group"
      aria-label="Drawing"
      style={
        {
          left: `${note.x}px`,
          top: `${note.y}px`,
          width: `${note.width}px`,
          height: `${note.height}px`,
          // Stacking is each object's own business, the note's and the shape's rule:
          // the element a drag has captured is never moved out from under the pointer.
          zIndex: note.z,
        } as CSSProperties
      }
    >
      {/* The box is the drawing's bounds, and the viewBox is that same box, so one
          unit of this drawing is one board unit at any zoom: the line scales with the
          object and the stroke width stays the thickness it was drawn with. */}
      <svg
        className="stroke-svg"
        width={note.width}
        height={note.height}
        viewBox={`${note.x} ${note.y} ${note.width} ${note.height}`}
        focusable="false"
      >
        {/* First of the two: the line a pointer can hit. Invisible, as wide as the
            click tolerance, and the only thing in this box that takes a press - which
            is what lets a click in the box but off the line reach whatever is
            underneath. */}
        <path
          className="stroke-hit"
          data-testid="stroke-hit"
          d={d}
          strokeWidth={clickable}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
        />
        {/* Selected, a halo of the selection colour behind the ink: the drawing keeps
            its own colour - a stroke is its colour, and a selection is not a repaint -
            while still saying which one the handles belong to. */}
        {selected ? (
          <path
            className="stroke-halo"
            data-testid="stroke-halo"
            d={d}
            strokeWidth={thickness + (STROKE_HIT_TOLERANCE_PX / zoom) * 1.5}
            aria-hidden="true"
          />
        ) : null}
        {/* The drawing. The midpoint-quadratic path through the stored line, with
            round caps: a one-point stroke is a zero-length line here, and a round cap
            is what draws that as the dot a tap made. */}
        <path
          className="stroke-ink"
          data-testid="stroke-ink"
          d={d}
          strokeWidth={thickness}
          stroke={PEN_COLORS[note.color]}
          role="img"
          aria-label="Drawing"
        />
      </svg>
    </div>
  );
}
