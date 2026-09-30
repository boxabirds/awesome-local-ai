import type { PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { type StrokeSnap, scaledPoints } from '../../shared/objects/stroke';
import { screenToWorld } from '../canvas/camera';
import { useBoardCamera } from '../canvas/useCamera';
import { viewportPoint } from './hitTest';
import { strokeHitTest } from './strokeHitTest';
import type { ObjectProps } from './types';

const PRIMARY_BUTTON = 0;

/**
 * A pen stroke (stroke.object): a smooth line with round ends and joins,
 * scaled to the object's current size while its thickness stays the stored
 * one (proportional resize). Only a press within max(thickness / 2,
 * STROKE_HIT_TOLERANCE_PX screen px) of the line reaches the transform
 * gesture; the rest of its box lets presses through to what is underneath.
 */
export function StrokeObject(props: ObjectProps): React.JSX.Element {
  const stroke = props.object as StrokeSnap;
  const { zoom } = props;
  const id = stroke.id;
  const { camera } = useBoardCamera();
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  const pts = scaledPoints(stroke).map((p) => ({ x: p.x - stroke.x, y: p.y - stroke.y }));
  const d = smoothPath(pts);
  const hitWidth = 2 * Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);

  const onLinePointerDown = (e: ReactPointerEvent<SVGPathElement>) => {
    if (e.button !== PRIMARY_BUTTON) return;
    const world = screenToWorld(camera, viewportPoint(e.currentTarget, e.clientX, e.clientY));
    // The hit area follows the smoothed curve; the registry test decides (by the line itself).
    if (!strokeHitTest(stroke, world, zoom)) return;
    e.stopPropagation();
    props.onPointerDown(e as unknown as ReactPointerEvent<HTMLElement>, id);
  };

  return (
    <div
      className={['stroke-object', props.selected && 'is-selected', props.transforming && 'is-dragging']
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label="Drawing"
      tabIndex={0}
      data-stroke-object=""
      data-id={id}
      data-color={stroke.color}
      data-thickness={stroke.thickness}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.transforming ? 'dragging' : 'idle'}
      // Only the line's hit area takes presses; the rest of the box lets them through.
      style={{ left: stroke.x, top: stroke.y, width: stroke.width, height: stroke.height, zIndex: stroke.z, pointerEvents: 'none' }}
      onFocus={(e) => {
        if (e.target !== e.currentTarget || props.selected) return;
        try {
          if (!e.currentTarget.matches(':focus-visible')) return;
        } catch {
          return;
        }
        props.onSelect(id);
      }}
    >
      <svg className="stroke-svg" width={stroke.width} height={stroke.height} aria-hidden="true" focusable="false">
        <path
          className="stroke-hit"
          data-testid="stroke-hit"
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          onPointerDown={onLinePointerDown}
        />
        <path
          className="stroke-line"
          data-testid="stroke-line"
          aria-label="Drawing"
          d={d}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
