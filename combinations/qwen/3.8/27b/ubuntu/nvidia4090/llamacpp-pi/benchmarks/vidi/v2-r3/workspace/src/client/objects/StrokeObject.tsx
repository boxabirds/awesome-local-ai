import type { ReactElement } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import {
  scaledPoints,
  type PenColor,
  type PenThickness,
  type StrokeSnap,
} from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

/**
 * Story 11 (stroke.object): renders one stroke as an SVG path — a smooth
 * line with round ends and joins, the pen colour and the WORLD thickness
 * (the width does not scale with zoom; the world layer transform handles
 * the screen mapping).
 *
 * Hit testing is by the drawn line, not the bbox: the visible path ignores
 * pointer events and a second, invisible path with a stroke of
 * `2 × max(half thickness, STROKE_HIT_TOLERANCE_PX / zoom)` world units
 * (a ≥ 6 screen-px target) accepts them. A click far from the line but
 * inside the bbox falls through to whatever is below (the container is
 * pointer-events: none).
 */
export function StrokeObject(props: ObjectProps): ReactElement {
  const { obj, zoom, selected } = props;
  const stroke = obj as StrokeSnap;
  const id = obj.id;
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const color = PEN_COLORS[stroke.color as PenColor] ?? PEN_COLORS.black;
  const t = PEN_THICKNESS_WORLD[stroke.thickness as PenThickness] ?? PEN_THICKNESS_WORLD.medium;
  // The drawn line in world coordinates, relative to this bbox's origin.
  const rel = scaledPoints(stroke).map((p) => ({ x: p.x - obj.x, y: p.y - obj.y }));
  const d = smoothPath(rel);
  // A zero-length path (a dot) can be hit-test-uncertain in some engines:
  // the hit path nubs it by a negligible world epsilon (the round cap of
  // the wide stroke still provides the target).
  const hitD =
    rel.length === 1 ? `M ${rel[0].x} ${rel[0].y} L ${rel[0].x + 0.01} ${rel[0].y}` : d;
  const hitWidth = 2 * Math.max(t / 2, STROKE_HIT_TOLERANCE_PX / zoom);

  const onPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    props.onObjectPointerDown(e, id);
  };

  return (
    <div
      data-stroke-id={id}
      data-object-id={id}
      {...(selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={t}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label="Drawing"
          style={{ pointerEvents: 'none' }}
        />
        <path
          d={hitD}
          data-stroke-hit="true"
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
          onPointerDown={onPointerDown}
        />
      </svg>
    </div>
  );
}
