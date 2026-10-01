import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

const HALF = 2;

/** Half the line's thickness or 6 screen pixels, whichever is larger. */
export function strokeHitRadius(s: StrokeSnap, zoom: number): number {
  return Math.max(PEN_THICKNESS_WORLD[s.thickness] / HALF, STROKE_HIT_TOLERANCE_PX / zoom);
}

/** True when `world` is close enough to the drawn line to select the stroke (not merely inside its bounds). */
export function hitsStroke(s: StrokeSnap, world: Point, zoom = 1): boolean {
  return distanceToPolyline(scaledPoints(s), world) <= strokeHitRadius(s, zoom);
}

export function StrokeObject(props: ObjectProps) {
  const stroke = props.object as StrokeSnap;
  const { zoom, selected } = props;
  const svg = useRef<SVGSVGElement>(null);
  if (!stroke.points || stroke.points.length < HALF) return <></>;
  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const origin = svg.current?.closest('[data-testid="board-world"]')?.getBoundingClientRect();
    return { x: (e.clientX - (origin?.left ?? 0)) / zoom, y: (e.clientY - (origin?.top ?? 0)) / zoom };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // Real pointers only reach the hit path inside the tolerance band; the check also covers synthetic events.
    if (!hitsStroke(stroke, toWorld(e), zoom)) return;
    e.stopPropagation();
    if (!props.readOnly) props.onObjectPointerDown(e, stroke.id);
  };

  return (
    <svg
      ref={svg}
      role="img"
      aria-label="Drawing"
      data-stroke-object=""
      data-note-id={stroke.id}
      data-selected={selected ? 'true' : 'false'}
      width={1}
      height={1}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: stroke.z }}
    >
      <path
        data-testid="stroke-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={HALF * strokeHitRadius(stroke, zoom)}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={onPointerDown}
      />
      <path
        data-testid="stroke-path"
        d={d}
        fill="none"
        stroke={PEN_COLORS[stroke.color as keyof typeof PEN_COLORS]}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  );
}
