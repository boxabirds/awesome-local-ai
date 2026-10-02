import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import type { StrokeSnapshot } from '../../shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { scaledPoints, penColorOf } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import type { EndEditNext } from '../board/useSelection';

export interface StrokeObjectProps {
  /** The stroke as stored: its box, its points, its pen. */
  obj: StrokeSnapshot;
  doc: Y.Doc;
  /** Camera zoom. It scales the click corridor and nothing about the drawing: the
   *  line is drawn in board units and the world layer's transform does the rest. */
  zoom: number;
  selected: boolean;
  /** A drawing has no text to edit, so these arrive with the others and go unused. */
  editing?: boolean;
  canEdit?: boolean;
  onSelect(id: string): void;
  /** Shift+click toggles the stroke in and out of the selection. */
  onToggle?(id: string): void;
  onStartEdit?(id: string): void;
  onEndEdit?(next: EndEditNext): void;
  /** Transform gesture handlers: called for pointer events on this object. */
  onGesturePointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onGesturePointerMove?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerUp?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerCancel?(e: ReactPointerEvent<HTMLDivElement>): void;
}

/** How far outside the stored box the drawing is painted and clicked. The box is
 *  already half a pen width larger than the points in it, which is enough for the
 *  line and not enough for the corridor a pointer is answered in. */
const OVERFLOW = 8;

/**
 * One finished freehand drawing: the points a pointer went through, painted as a
 * smooth line.
 *
 * The path is drawn in the box's own coordinates, which are board units, so the one
 * transform of the world layer scales it with everything else and a sketch at 10 % is
 * the same drawing with fewer pixels. The points come from `scaledPoints`, which is
 * what makes a resize scale the drawing rather than the drawing's box: the stored
 * points are multiplied by the box's new size over the size it was made at, and a
 * stroke dragged twice as wide is the same drawing twice as wide.
 *
 * The width of the line is the stored pen, not a scaled one. Resizing a signature does
 * not fatten the pen it was signed with, so `stroke-width` is read out of the palette
 * here and given no part of the box's ratio.
 *
 * Where it can be clicked is the other half of what a stroke is. The box under a
 * drawing is where the drawing happens to be and nothing more — an underline's box
 * covers the whole of the sentence above it — so the wrapper and the painted line let
 * the pointer through, and only the wide transparent corridor drawn along the line
 * answers it. That corridor is drawn `2 * STROKE_HIT_TOLERANCE_PX / zoom` board units
 * wide, which is the same corridor the model measures a click against: the place a
 * person can click a stroke is the place the board says a stroke is, at every zoom.
 */
export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  /** Is a press of ours in flight? A shift+press toggles the selection and is over as
   *  far as this drawing is concerned; a drawing that went on to answer the release
   *  of a toggle would undo the toggle it had just honoured, which is the one thing a
   *  shift+click must not do. */
  const held = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on a drawing is never a pan.
    e.stopPropagation();
    if (e.shiftKey) {
      propsRef.current.onToggle?.(obj.id);
      return;
    }
    held.current = true;
    propsRef.current.onGesturePointerDown?.(e, obj.id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!held.current) return;
    e.stopPropagation();
    propsRef.current.onGesturePointerMove?.(e);
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!held.current) return;
    e.stopPropagation();
    held.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.type === 'pointerup') propsRef.current.onGesturePointerUp?.(e);
    else propsRef.current.onGesturePointerCancel?.(e);
    // A press that did not become a drag has selected the stroke.
    propsRef.current.onSelect(obj.id);
  };

  const obj = props.obj;
  const zoom = props.zoom > 0 ? props.zoom : 1;
  const box = {
    left: obj.x - OVERFLOW,
    top: obj.y - OVERFLOW,
    width: obj.width + OVERFLOW * 2,
    height: obj.height + OVERFLOW * 2,
  };
  const style = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    zIndex: obj.z,
    // The wrapper is not a target: everything under it that answers the pointer is
    // a corridor drawn along the line, and the box itself is board.
    pointerEvents: 'none',
  } as CSSProperties;

  // The points are where the drawing is; the path is how they are painted. Both the
  // line and its corridor are drawn from the same points, in the same box, so the one
  // cannot wander from the other.
  const line = scaledPoints(obj);
  const d = smoothPath(line);
  const corridor = (STROKE_HIT_TOLERANCE_PX * 2) / zoom;

  return (
    <div
      className={`stroke-object${props.selected ? ' is-selected' : ''}`}
      data-stroke-id={obj.id}
      data-selected={props.selected ? 'true' : 'false'}
      // The pen it was drawn with, as it was stored: a stroke that changed colour
      // because somebody chose another swatch afterwards would be a stroke rewritten.
      data-color={obj.color}
      data-thickness={obj.thickness}
      data-points={line.length}
      // The box the drawing is stored in, in board units, as the drawing itself says
      // it: the same way an arrow reports its two ends. A resize of a drawing is a
      // change of this box and of nothing else about the pen, and a test that wanted
      // to see the difference has to be able to read both.
      data-box-x={obj.x}
      data-box-y={obj.y}
      data-box-width={obj.width}
      data-box-height={obj.height}
      data-testid="stroke-object"
      role="group"
      aria-label="Drawing"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
    >
      <svg
        className="stroke-svg"
        data-testid="stroke-svg"
        width={box.width}
        height={box.height}
        // The box's own corner in board units, so a point of the drawing is one unit
        // of the picture and the world layer's transform does all the scaling.
        viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* The corridor first, so the line is painted over it: invisible, and the only
            part of this drawing the pointer can find. */}
        <path
          className="stroke-hit"
          data-testid="stroke-hit"
          d={d}
          style={{ pointerEvents: 'stroke' }}
          strokeWidth={corridor}
        />
        <path
          className="stroke-line"
          data-testid="stroke-line"
          d={d}
          // The colour and the width the stroke was drawn with, as stored: the two
          // things about a finished drawing that no later choice can change.
          stroke={penColorOf(obj.color)}
          strokeWidth={PEN_THICKNESS_WORLD[obj.thickness]}
        />
      </svg>
    </div>
  );
}
