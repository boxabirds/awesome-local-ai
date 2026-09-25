import { memo, useContext, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { polylinePath, smoothPath } from '../../shared/geometry/simplify';
import { isStroke, scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { BoardContext } from '../board/BoardContext';
import type { ObjectProps } from './registry';

/** World distance from a stroke's line within which a point is on it at `zoom` (pen.select). */
export function strokeHitTolerance(s: StrokeSnap, zoom = 1): number {
  return Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
}

/** The registry's hit test for strokes: close to the drawn line, not anywhere inside the box. */
export function strokeHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  if (!isStroke(obj)) return false;
  return distanceToPolyline(scaledPoints(obj), p) <= strokeHitTolerance(obj, zoom);
}

/**
 * A finished stroke's line: a smoothed SVG path through its points scaled to the current size, with round caps and
 * joins and the stroke's thickness in world units (never scaled by a resize). Drawn in world coordinates.
 */
export function StrokeObject(props: { stroke: StrokeSnap; selected: boolean }) {
  const { stroke: s } = props;
  return (
    <path
      className="stroke-object__line"
      data-testid="stroke-line"
      d={smoothPath(scaledPoints(s))}
      fill="none"
      stroke={PEN_COLORS[s.color]}
      strokeWidth={PEN_THICKNESS_WORLD[s.thickness]}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
      aria-label="Drawing"
    />
  );
}

function StrokeAdapter(props: ObjectProps) {
  const { object, zoom, selected } = props;
  const board = useContext(BoardContext);
  // A pointer is down on this stroke: its focus event must not change the selection (the gesture does that).
  const pointerDownRef = useRef(false);
  if (!isStroke(object)) return null;
  const s = object;
  const tolerance = strokeHitTolerance(s, zoom);
  const points = scaledPoints(s);
  const pad = tolerance + PEN_THICKNESS_WORLD[s.thickness];
  const box = { x: s.x - pad, y: s.y - pad, width: s.width + 2 * pad, height: s.height + 2 * pad };

  const releasePointer = () => {
    pointerDownRef.current = false;
  };
  const onLinePointerDown = (e: ReactPointerEvent) => {
    // A press farther than the tolerance from the line is not on the stroke (pen.select).
    if (distanceToPolyline(points, board.toWorld(e.clientX, e.clientY)) > tolerance) return;
    e.stopPropagation();
    pointerDownRef.current = true;
    window.addEventListener('pointerup', releasePointer, { once: true, capture: true });
    window.addEventListener('pointercancel', releasePointer, { once: true, capture: true });
    props.onObjectPointerDown(e, s.id);
  };

  return (
    <div
      className={`stroke-object${selected ? ' stroke-object--selected' : ''}`}
      role="group"
      aria-roledescription="drawing"
      aria-label="Drawing"
      data-object-id={s.id}
      data-stroke-id={s.id}
      data-color={s.color}
      data-thickness={s.thickness}
      data-selected={selected}
      tabIndex={0}
      style={{ zIndex: props.stackIndex }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !selected && !pointerDownRef.current) props.onSelect(s.id);
      }}
    >
      <svg
        className="stroke-object__svg"
        style={{ left: box.x, top: box.y }}
        width={box.width}
        height={box.height}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        aria-hidden="true"
      >
        <StrokeObject stroke={s} selected={selected} />
        <path
          className="stroke-object__hit"
          data-testid="stroke-hit"
          d={polylinePath(points)}
          fill="none"
          stroke="transparent"
          strokeWidth={2 * tolerance}
          strokeLinecap="round"
          strokeLinejoin="round"
          onPointerDown={onLinePointerDown}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      </svg>
    </div>
  );
}

/** The registry's component for strokes. */
export const StrokeObjectView = memo(StrokeAdapter);
