/**
 * A drawn stroke on the board (story 11): the line a Pen left behind, and nothing else.
 *
 * The stroke is drawn from its stored points scaled to its current box, so the generic story 7 writes
 * are all a stroke ever needs: moving it moves the box, resizing it scales the drawing inside the box in
 * proportion, and the ink itself stays the thickness it was drawn with. A stroke that someone else drew
 * arrives as a snapshot and is drawn the same way, from the same two functions that answer "where is the
 * line" and "what path draws it".
 *
 * What a click is measured against is the line, not the box. A scribble's bounding box is mostly empty -
 * that is what a scribble is - so the wrapper takes no pointers at all and one invisible path, as wide on
 * the screen as the click tolerance, is the whole of its hit area (TC-16: a click inside the box of a
 * circle drawn round a note is a click on the note).
 */
import { memo, type CSSProperties, type JSX } from 'react';
import { STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD } from '../../shared/config';
import { scaledPoints, penColorValue, type StrokeSnapshot } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { ObjectProps } from './ObjectProps';

export interface StrokeObjectProps extends ObjectProps {
  note: StrokeSnapshot;
}

function StrokeObjectBase({
  note,
  zoom,
  selected,
  onObjectPointerDown,
}: StrokeObjectProps): JSX.Element {
  // The line as it hangs on the board now: stored points, scaled to the box it has been moved and
  // resized into. World units throughout - the world layer is what scales with the zoom.
  const d = smoothPath(scaledPoints(note));
  const safeZoom = zoom > 0 ? zoom : 1;
  // As wide on the screen as the click tolerance, whichever way the zoom has gone: half the thickness,
  // or 6 screen pixels, whichever is more.
  const hitWidth =
    2 * Math.max(PEN_THICKNESS_WORLD[note.thickness] / 2, STROKE_HIT_TOLERANCE_PX / safeZoom);

  const style = {
    left: note.x,
    top: note.y,
    width: note.width,
    height: note.height,
    zIndex: note.z,
  } as CSSProperties;

  return (
    <div
      className="stroke-object"
      data-board-object
      data-stroke-object
      data-stroke-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-stroke-color={note.color}
      data-stroke-thickness={note.thickness}
      data-testid="stroke-object"
      style={style}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // Only the invisible line answers, so a pointer that got here is on the stroke: the generic
        // gesture does the selecting, the shift-toggle and the drag.
        event.stopPropagation();
        onObjectPointerDown(event, note.id);
      }}
    >
      <svg
        className="stroke-object__svg"
        width={note.width}
        height={note.height}
        viewBox={`${note.x} ${note.y} ${note.width} ${note.height}`}
        role="img"
        aria-label="Drawing"
        focusable="false"
      >
        <path
          className="stroke-object__line"
          data-testid="stroke-line"
          d={d}
          stroke={penColorValue(note.color)}
          strokeWidth={PEN_THICKNESS_WORLD[note.thickness]}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* The target a click is measured against, drawn transparently on the very same path. */}
        <path
          className="stroke-object__hit"
          data-testid="stroke-hit"
          d={d}
          strokeWidth={hitWidth}
        />
      </svg>
    </div>
  );
}

/**
 * Memoised like the other object components: a stroke never changes once it is drawn, so the only thing
 * that makes this re-render is its box having been moved or resized, or its being selected.
 */
export const StrokeObject = memo(StrokeObjectBase);
