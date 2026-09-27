// Story 11: one stroke (anchor: stroke.object): render, select by line, and
// let the shared story 7 gesture move / aspect-resize / delete it.
//
// The rendered line is DERIVED: `scaledPoints` re-derives the stored (bbox-
// relative, creation-size) points at the current size, so a proportional
// resize changes the drawn line without rewriting it (pen.resize). The
// thickness is never scaled.
//
// Interaction:
//  - the whole object is pointer-events: none except the invisible hit band
//    around the line, so a click inside the bbox but away from the line falls
//    through to whatever is underneath (pen.select);
//  - a click on the hit band selects the stroke via the shared transform
//    gesture (onPointerDown); move / resize / delete come unchanged from
//    story 7 (the registry marks the type resizable + aspectLocked).

import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import { smoothPath } from '../../shared/geometry/simplify';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { ObjectProps } from './registry';

/**
 * A polyline path (`M x y L x y ...`) through the points. Used for the
 * invisible hit band so the catchable region matches the `distanceToPolyline`
 * check exactly (the smooth body curve can dip well inside the polyline
 * vertices on tight curves, which would leave the vertices uncatchable).
 */
function polylinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  const p = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);
  let d = `M ${p(pts[0]!.x)} ${p(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${p(pts[i]!.x)} ${p(pts[i]!.y)}`;
  }
  return d;
}

export function StrokeObject(props: ObjectProps): JSX.Element {
  const { obj, selected } = props;
  const s = obj as StrokeSnap;
  const zoom = props.zoom ?? 1;
  // The camera changes with every render; the hit-test closure reads it
  // through this ref so a pan/zoom since the last paint still converts
  // correctly.
  const camRef = { current: props.camera ?? ({ x: 0, y: 0, zoom: 1 } as Camera) };

  const thickness = PEN_THICKNESS_WORLD[s.thickness];
  const color = PEN_COLORS[s.color];
  const points = scaledPoints(s);
  const d = smoothPath(points);
  const hitD = polylinePath(points);
  // The band is at least the visible stroke wide and at least
  // STROKE_HIT_TOLERANCE_PX screen px on each side, so the line is always
  // catchable regardless of zoom.
  const hitWidth = Math.max(thickness, (2 * STROKE_HIT_TOLERANCE_PX) / zoom);

  const onPointerDown = (e: ReactPointerEvent<SVGPathElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // The DOM band (pointer-events: stroke) is the primary mechanism; this
    // explicit check enforces the same ±STROKE_HIT_TOLERANCE_PX screen-px
    // contract (or half the thickness, whichever is larger) where CSS
    // hit-testing is unavailable (jsdom), and keeps the line hit test exact.
    const root = document.querySelector('[data-testid="board-viewport"]');
    if (root !== null) {
      const rect = root.getBoundingClientRect();
      const p = screenToWorld(camRef.current, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      const rel: Point = { x: p.x - s.x, y: p.y - s.y };
      const tol = Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / camRef.current.zoom);
      if (distanceToPolyline(points, rel) > tol) return;
    }
    e.stopPropagation();
    props.onPointerDown(e);
  };

  return (
    <svg
      className="stroke-object"
      data-testid="stroke-object"
      data-stroke-id={obj.id}
      data-stroke-thickness={s.thickness}
      data-selected={selected ? '' : undefined}
      width={s.width}
      height={s.height}
      viewBox={`0 0 ${s.width} ${s.height}`}
      aria-label="Drawing"
      style={{ left: s.x, top: s.y, overflow: 'visible' }}
    >
      <path
        className="stroke-object__body"
        data-testid="stroke-body"
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Hit band: an invisible wide stroke so the line is clickable at any
          zoom (pen.select). pointer-events: stroke keeps the empty bbox area
          transparent to the pointer so clicks fall through to objects below. */}
      <path
        className="stroke-object__hit"
        data-testid="stroke-hit"
        d={hitD}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={onPointerDown}
      />
    </svg>
  );
}
