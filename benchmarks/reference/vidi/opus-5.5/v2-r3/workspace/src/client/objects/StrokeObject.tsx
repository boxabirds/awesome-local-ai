import { useContext, useRef, type PointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { screenToWorld } from '../canvas/camera';
import { CameraContext } from '../canvas/useCamera';
import { strokeHitTest, type ObjectProps } from './registry';

const HALF = 2;

/**
 * One freehand stroke (story 11, stroke.object): a smoothed SVG path with round
 * caps and joins, drawn at the stroke's current size (a resize scales the line,
 * never its thickness). Only presses close to the line select it (pen.select):
 * the box itself ignores the pointer, so presses elsewhere inside it reach the
 * objects underneath. Selection, move, resize and delete are generic (story 7).
 */
export function StrokeObject(props: ObjectProps & { stroke?: StrokeSnap }) {
  const s = (props.stroke ?? props.object) as StrokeSnap;
  const zoom = props.zoom ?? 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const cameraCtx = useContext(CameraContext);
  const cameraRef = useRef(cameraCtx?.api.camera);
  cameraRef.current = cameraCtx?.api.camera;

  const thickness = PEN_THICKNESS_WORLD[s.thickness];
  const local = scaledPoints(s).map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
  // Corners round off within the line's own thickness, so the drawn shape is kept.
  const d = smoothPath(local, thickness);
  const hitWidth = Math.max(thickness / HALF, STROKE_HIT_TOLERANCE_PX / zoom) * HALF;

  /** Client coordinates → world, through the board camera (null outside a board). */
  const clientToWorld = (clientX: number, clientY: number): Point | null => {
    const camera = cameraRef.current;
    const vp = rootRef.current?.closest('.board-viewport');
    if (!camera || !vp) return null;
    const r = vp.getBoundingClientRect();
    return screenToWorld(camera, { x: clientX - r.left, y: clientY - r.top });
  };

  const onLinePointerDown = (e: PointerEvent<SVGPathElement>) => {
    if (e.button !== 0) return;
    const world = clientToWorld(e.clientX, e.clientY);
    if (world && !strokeHitTest(s, world, zoom)) return;
    e.stopPropagation(); // the board must not pan
    props.onPointerDown(e, s.id);
  };

  return (
    <div
      ref={rootRef}
      className={`stroke-object board-object${props.gesture === 'dragging' ? ' is-dragging' : ''}`}
      role="group"
      aria-roledescription="drawing"
      aria-label="Drawing"
      tabIndex={0}
      data-stroke-id={s.id}
      data-object-id={s.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.gesture}
      data-color={s.color}
      data-thickness={s.thickness}
      data-z={s.z}
      style={{ left: s.x, top: s.y, width: s.width, height: s.height, zIndex: props.zIndex }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="stroke-svg" width={s.width} height={s.height} focusable="false" aria-hidden="true">
        <path
          className="stroke-line"
          data-testid="stroke-line"
          d={d}
          fill="none"
          stroke={PEN_COLORS[s.color]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
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
      </svg>
    </div>
  );
}
