import type { CSSProperties, JSX } from 'react';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { isStrokeSnapshot, penColorValue, scaledPoints } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import { smoothPath } from '../../shared/geometry/simplify';
import { SELECTION_OUTLINE, SELECTED_STACK_ABOVE } from './StickyNote';
import type { ObjectProps } from '../objects/registry';

/** What a stroke is announced as (PRD: "strokes are announced as 'Drawing'"). */
export const STROKE_ARIA_LABEL = 'Drawing';

/**
 * One finished stroke (`stroke.object`): the line the Pen left behind, drawn as an SVG path
 * through the middle of each of its segments, with round caps and joins so it reads as ink
 * rather than as a chain of straight lines.
 *
 * It stores nothing of its own. The snapshot says where the box is and how big it is now, and
 * `scaledPoints` turns the points recorded when it was drawn into the line where it is *now* —
 * which is the whole of why a stroke moves and resizes with story 7's generic code and why a
 * resize keeps its proportions (`pen.resize`). The thickness is not scaled: it is a property of
 * the line rather than of its box, so making a sketch larger does not make its lines fatter.
 *
 * The box of a stroke is mostly empty board, so — exactly as for an arrow — only the line
 * itself takes the pointer: a transparent path `STROKE_HIT_TOLERANCE_PX` screen pixels wide on
 * each side is what a click has to land on. Click inside the box but away from the line and the
 * press goes through to whatever is underneath (PRD: pen.select), which is the registry's hit
 * test applied by the browser instead of by the code.
 */
export function StrokeObject(props: ObjectProps): JSX.Element | null {
  if (!isStrokeSnapshot(props.object)) return null;
  return <StrokeObjectBody {...props} stroke={props.object} />;
}

interface StrokeObjectBodyProps extends ObjectProps {
  stroke: StrokeSnap;
}

function StrokeObjectBody({
  stroke,
  zoom,
  selected,
  editing,
  dragging,
  onObjectPointerDown,
}: StrokeObjectBodyProps): JSX.Element {
  const width = Math.max(stroke.width, 0);
  const height = Math.max(stroke.height, 0);
  // The line where it is now, in the box's own coordinates: the SVG sits on the box's top-left,
  // so the path does not have to know where the board is.
  const line = scaledPoints(stroke).map(
    (point): Point => ({ x: point.x - stroke.x, y: point.y - stroke.y }),
  );
  const d = smoothPath(line);
  // Thickness in board units, unscaled by the resize that was done on the box.
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness] ?? 0;
  // Six screen pixels on each side of the line, in the board units that make at this zoom —
  // the same tolerance the registry's hit test answers with, so clicking where the line is and
  // asking the registry whether a point is on it cannot disagree.
  const hitWidth = (STROKE_HIT_TOLERANCE_PX * 2) / (zoom > 0 ? zoom : 1);

  const style: CSSProperties = {
    position: 'absolute',
    left: `${stroke.x}px`,
    top: `${stroke.y}px`,
    width: `${width}px`,
    height: `${height}px`,
    // Round caps and the click margin both reach outside the box.
    overflow: 'visible',
    zIndex: selected ? SELECTED_STACK_ABOVE : stroke.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
    // Nothing here takes the pointer except the line itself.
    pointerEvents: 'none',
  };

  return (
    <div
      className="vidi6-stroke"
      data-testid="stroke-object"
      data-note-id={stroke.id}
      data-note-type="stroke"
      data-note-x={stroke.x}
      data-note-y={stroke.y}
      data-note-z={stroke.z}
      data-note-width={width}
      data-note-height={height}
      data-stroke-color={stroke.color}
      data-stroke-thickness={stroke.thickness}
      data-stroke-created-by={stroke.createdBy}
      data-stroke-point-count={Math.floor((stroke.points?.length ?? 0) / 2)}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={STROKE_ARIA_LABEL}
      style={style}
    >
      <svg
        className="vidi6-stroke-svg"
        data-testid="stroke-svg"
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* The click target first, so the ink sits on top of its own margin. */}
        <path
          data-testid="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          onPointerDown={(event) => {
            if (event.pointerType === 'touch') return;
            if (event.button !== 0) return;
            event.stopPropagation();
            // Selecting, raising and — if the pointer then moves — dragging are the gesture's
            // business, as they are for every other type.
            onObjectPointerDown(event, stroke.id);
          }}
        />
        <path
          data-testid="stroke-line"
          d={d}
          fill="none"
          stroke={penColorValue(stroke.color)}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
