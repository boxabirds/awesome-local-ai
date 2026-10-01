import type { PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

/** A finished freehand stroke; only the line itself (plus a few pixels) takes pointer events, never its bounds. */
export function StrokeObject(props: ObjectProps) {
  const stroke = props.object as StrokeSnap;
  const { selected, zoom } = props;
  const width = PEN_THICKNESS_WORLD[stroke.thickness];
  const d = smoothPath(scaledPoints({ ...stroke, x: 0, y: 0 }));

  const onPointerDown = (e: ReactPointerEvent<SVGPathElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, stroke.id);
  };

  return (
    <svg
      role="group"
      aria-label="Drawing"
      data-object-id={stroke.id}
      data-stroke-id={stroke.id}
      data-selected={selected ? 'true' : 'false'}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-z={stroke.z}
      width={stroke.width}
      height={stroke.height}
      style={{ position: 'absolute', left: stroke.x, top: stroke.y, overflow: 'visible', pointerEvents: 'none', zIndex: stroke.z }}
    >
      <path
        data-testid="stroke-path"
        d={d}
        fill="none"
        stroke={PEN_COLORS[stroke.color]}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        data-testid="stroke-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(width, (2 * STROKE_HIT_TOLERANCE_PX) / zoom)}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
      />
    </svg>
  );
}
