/**
 * One finished pen stroke in the world layer (anchors: stroke.object, pen.select, pen.resize).
 *
 * A smooth SVG path through the stroke's points scaled to its current size, in its colour
 * and thickness (world units, so it scales with zoom; resizing never changes the thickness),
 * with round caps and joins; a one-point stroke is a round dot. Only a band around the line
 * (half the thickness or STROKE_HIT_TOLERANCE_PX screen pixels, whichever is larger) takes
 * pointer input, so a press elsewhere in its bounding box reaches whatever is underneath;
 * the press is re-checked with the registry hit test and then goes to the generic transform
 * gesture like any other object.
 */
import { memo, useContext, useRef, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { BoardContext } from '../canvas/BoardContext';
import { screenToWorld } from '../canvas/camera';
import { getObjectType, type ObjectProps } from './registry';

const HALF = 2;
const PRIMARY_BUTTON = 0;

export const STROKE_LABEL = 'Drawing';

export interface StrokeObjectProps extends Partial<Omit<ObjectProps, 'object' | 'selected'>> {
  stroke: StrokeSnap;
  selected: boolean;
}

function StrokeObjectImpl(props: StrokeObjectProps): React.JSX.Element {
  const { stroke: s, selected } = props;
  const zoom = props.zoom ?? 1;
  const board = useContext(BoardContext);
  const pointerActive = useRef(false);
  const thickness = PEN_THICKNESS_WORLD[s.thickness];
  const local = scaledPoints(s).map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
  const d = smoothPath(local);
  const hitWidth = Math.max(thickness, (HALF * STROKE_HIT_TOLERANCE_PX) / zoom);

  const onPointerDown = (e: PointerEvent<SVGPathElement>) => {
    if (e.button !== PRIMARY_BUTTON) return;
    // The band is the hit area; still confirm the distance to the line (pen.select).
    const cam = board?.board.camera;
    if (cam !== undefined) {
      const vp = e.currentTarget.closest('.board-viewport')?.getBoundingClientRect();
      const p = screenToWorld(cam, { x: e.clientX - (vp?.left ?? 0), y: e.clientY - (vp?.top ?? 0) });
      const spec = getObjectType(s.type);
      if (spec !== undefined && !spec.hitTest(s, p, cam.zoom)) return;
    }
    e.stopPropagation();
    pointerActive.current = true;
    props.onPointerDown?.(e as unknown as PointerEvent<HTMLElement>, s.id);
  };
  const onPointerEnd = () => {
    pointerActive.current = false;
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerActive.current || selected) return;
    props.onSelect?.(s.id);
  };

  const style = {
    left: `${s.x}px`,
    top: `${s.y}px`,
    width: `${s.width}px`,
    height: `${s.height}px`,
    zIndex: s.z,
  } as CSSProperties;
  const state = props.transforming === true ? 'dragging' : selected ? 'selected' : 'unselected';

  return (
    <div
      className="stroke-object"
      role="group"
      aria-roledescription="drawing"
      aria-label={STROKE_LABEL}
      tabIndex={0}
      data-id={s.id}
      data-type="stroke"
      data-color={s.color}
      data-thickness={s.thickness}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      style={style}
      onFocus={onFocus}
    >
      <svg className="stroke-svg" width={s.width} height={s.height} aria-hidden="true" focusable="false">
        <path
          className="stroke-line"
          data-testid="stroke-line"
          aria-label={STROKE_LABEL}
          d={d}
          fill="none"
          stroke={PEN_COLORS[s.color]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
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
          onPointerDown={onPointerDown}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      </svg>
    </div>
  );
}

export const StrokeObject = memo(StrokeObjectImpl);
