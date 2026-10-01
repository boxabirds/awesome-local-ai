import type { StrokeSnapshot } from '../../shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

const HALF = 2;

/** A finished freehand stroke: a smoothed round-capped path; only the line itself takes pointer events. */
export function StrokeObject(props: ObjectProps) {
  const s = props.object as StrokeSnapshot;
  const { zoom, selected } = props;
  const pts = scaledPoints(s).map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
  const d = smoothPath(pts);
  const width = PEN_THICKNESS_WORLD[s.thickness];
  const hitWidth = Math.max(width, (STROKE_HIT_TOLERANCE_PX * HALF) / zoom);
  return (
    <div
      className="stroke-object"
      data-stroke-object=""
      data-object-id={s.id}
      data-note-id={s.id}
      data-selected={selected ? 'true' : 'false'}
      role="img"
      aria-label="Drawing"
      style={{ left: s.x, top: s.y, width: s.width, height: s.height, zIndex: s.z }}
    >
      <svg className="stroke-svg" width="1" height="1">
        <path
          data-testid="stroke-hit"
          d={d}
          fill="none" stroke="transparent" strokeWidth={hitWidth} strokeLinecap="round" strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
          onPointerDown={(e) => props.onObjectPointerDown(e, s.id)}
        />
        <path
          data-testid="stroke-path"
          d={d}
          fill="none" stroke={PEN_COLORS[s.color]} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
