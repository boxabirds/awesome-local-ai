import { useMemo, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '@/shared/config';
import { smoothPath } from '@/shared/geometry/simplify';
import {
  scaledPoints,
  isStrokeSnap,
  type PenColor,
  type PenThickness,
  type StrokeSnap,
} from '@/shared/objects/stroke';
import type { ObjectSnapshot } from '@/shared/board-model';

/**
 * Stroke object (story 11): renders a freehand stroke at its bbox position.
 *
 * The DOM element is a positioned div (left/top = bbox, z = stack order) with
 * pointerEvents none, so it never blocks hits on objects below. Inside it an
 * SVG (overflow visible) holds TWO paths sharing the exact same `d`:
 *
 * - data-testid="stroke-hit": an INVISIBLE path stroked at
 *   `max(thickness, STROKE_HIT_TOLERANCE_PX / zoom) * 2` screen-equivalent
 *   world width with pointerEvents "stroke" — the line-distance hit test
 *   (pen.select). Clicks on it are routed to the gesture (move) / selection;
 *   the visible line itself never receives pointer events.
 * - data-testid="stroke-line": the visible ink (round caps/joins),
 *   pointer-events none.
 *
 * Both paths are drawn in LOCAL coordinates (relative to the bbox origin) and
 * scaled by width/baseWidth, height/baseHeight — proportional resize (story 7)
 * therefore scales the line without ever rewriting the points. The thickness
 * is NOT scaled (it is a pen setting). The hit path is wider than the bbox by
 * exactly the extra screen-pixel tolerance, which is why the div is padded.
 *
 * The whole object scales with the world like every other object (zoom 50%
 * shows half the width; zoom 200% doubles it) — the only zoom dependence is
 * the constant-size hit tolerance (pen.select).
 */
export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  /** Current camera zoom (for the constant screen-px hit tolerance). */
  zoom?: number;
  /** Routed from the object root (registry ObjectProps.onObjectPointerDown). */
  onObjectPointerDown?: (e: ReactPointerEvent<Element>) => void;
}

export function StrokeObject(props: StrokeObjectProps): ReactElement | null {
  const s = props.stroke;
  const valid = isStrokeSnap(s);
  const zoom = typeof props.zoom === 'number' && Number.isFinite(props.zoom) && props.zoom > 0 ? props.zoom : 1;
  const thickness = PEN_THICKNESS_WORLD[s.thickness as PenThickness] ?? PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
  const color = PEN_COLORS[s.color as PenColor] ?? PEN_COLORS[DEFAULT_PEN_COLOR];

  // Local (bbox-relative) smoothed path at the CURRENT size. Deterministic
  // for deterministic input (smoothPath).
  const d = useMemo((): string => {
    if (!valid) return '';
    const local = scaledPoints(s as StrokeSnap).map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
    return smoothPath(local);
  }, [
    valid,
    s.x,
    s.y,
    s.width,
    s.height,
    s.baseWidth,
    s.baseHeight,
    s.points,
  ]);

  if (!valid || d === '') return null;

  // Half the hit width in world units: half the thickness or the screen-pixel
  // tolerance converted to world, whichever is larger (pen.select).
  const hitHalf = Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  // Extra padding beyond the (thickness-padded) bbox for the hit band.
  const pad = Math.max(0, hitHalf - thickness / 2);
  const w = s.width + pad * 2;
  const h = s.height + pad * 2;

  return (
    <div
      data-testid="stroke"
      data-id={s.id}
      data-type="stroke"
      data-selected={props.selected ? true : undefined}
      style={{
        position: 'absolute',
        left: s.x - pad,
        top: s.y - pad,
        width: w,
        height: h,
        zIndex: s.z,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={w}
        height={h}
        style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}
      >
        <g transform={`translate(${pad} ${pad})`}>
          <path
            data-testid="stroke-hit"
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={hitHalf * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'move' }}
            onPointerDown={(e) => {
              props.onObjectPointerDown?.(e);
            }}
          />
          <path
            data-testid="stroke-line"
            aria-label="Drawing"
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      </svg>
    </div>
  );
}

/** Type guard used by tests: is this snapshot a well-formed stroke? */
export function hasStroke(o: ObjectSnapshot): boolean {
  return o.type === 'stroke' && isStrokeSnap(o);
}
