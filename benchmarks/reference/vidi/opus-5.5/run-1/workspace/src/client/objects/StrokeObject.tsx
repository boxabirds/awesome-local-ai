import { memo, useRef, type CSSProperties, type FocusEvent as ReactFocusEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { smoothPath } from '../../shared/geometry/simplify';
import { isStroke, scaledLocalPoints, scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './objectTypes';
import type { ObjectSnapshot } from '../../shared/board-model';

export const STROKE_LABEL = 'Drawing';
const HALF = 2;
/** Selection highlight around the line, screen px on each side. */
const SELECTED_HALO_PX = 6;

/**
 * True when `p` is within STROKE_HIT_TOLERANCE_PX screen px of the stroke's line, or within
 * half its thickness if that is larger (pen.select). Clicks inside the box but away from the
 * line miss, so they reach the objects below.
 */
export function strokeHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  if (!isStroke(obj) || !(zoom > 0)) return false;
  const tolerance = Math.max(PEN_THICKNESS_WORLD[obj.thickness] / HALF, STROKE_HIT_TOLERANCE_PX / zoom);
  return distanceToPolyline(scaledPoints(obj), p) <= tolerance;
}

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  /** Screen px per world unit (only for the selection halo width). Default 1. */
  zoom?: number;
}

/**
 * The drawn line of one stroke: a smooth SVG path through its points scaled to the current box
 * (so a resize scales the line in proportion while the thickness stays the same), round caps
 * and joins, in world units.
 */
export function StrokeObject({ stroke, selected, zoom = 1 }: StrokeObjectProps) {
  const d = smoothPath(scaledLocalPoints(stroke));
  const width = PEN_THICKNESS_WORLD[stroke.thickness];
  return (
    <svg
      className="stroke-object__svg"
      width={stroke.width}
      height={stroke.height}
      viewBox={`0 0 ${stroke.width} ${stroke.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {selected && (
        <path
          className="stroke-object__halo"
          d={d}
          fill="none"
          strokeWidth={width + (SELECTED_HALO_PX * HALF) / zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        data-testid="stroke-path"
        aria-label={STROKE_LABEL}
        d={d}
        fill="none"
        stroke={PEN_COLORS[stroke.color]}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A stroke on the board (registry component). It takes no pointer events itself: the board
 * routes presses near its line to it (pen.select), so objects beneath stay clickable. Tab
 * focus selects it; it is announced as "Drawing".
 */
function StrokeBoardObjectImpl(props: ObjectProps) {
  const { object, zoom, stackIndex, selected, dragging, onSelect } = props;
  const pointerFocusRef = useRef(false);
  if (!isStroke(object)) return null;
  const s = object;

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(s.id);
  };

  const style: CSSProperties = {
    transform: `translate(${s.x}px, ${s.y}px)`,
    width: s.width,
    height: s.height,
    zIndex: stackIndex,
  };
  const className = [
    'stroke-object',
    selected && 'stroke-object--selected',
    dragging && 'stroke-object--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="group"
      aria-roledescription="drawing"
      aria-label={STROKE_LABEL}
      tabIndex={0}
      data-testid="stroke-object"
      data-id={s.id}
      data-color={s.color}
      data-thickness={s.thickness}
      data-selected={selected ? 'true' : 'false'}
      style={style}
      onFocus={onFocus}
      onPointerDown={() => {
        pointerFocusRef.current = true;
      }}
    >
      <StrokeObject stroke={s} selected={selected} zoom={zoom} />
    </div>
  );
}

export const StrokeBoardObject = memo(StrokeBoardObjectImpl);
