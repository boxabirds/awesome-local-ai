// StrokeObject (story 11, stroke.object): renders a freehand pen stroke as
// a smoothed SVG path in world coordinates.
//
//  - The visible path draws smoothPath of the stroke's points scaled to its
//    CURRENT width/height (scaledPoints): a proportional resize scales the
//    drawn line while the line width stays the stored thickness (pen.resize).
//    Remote strokes render identically as soon as the snapshot updates.
//  - Selection: a press within the line hit tolerance goes through an
//    invisible wide hit path to the generic gesture (pen.select). The
//    visible path never catches the pointer, and a press inside the bbox but
//    far from the line falls through to the objects below (the hit path is
//    only as wide as the tolerance, never the bbox).

import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import type { ObjectProps } from './registry';

export function StrokeObject(props: ObjectProps): JSX.Element | null {
  const { obj, zoom, selected, onPointerDown } = props;
  if (obj.type !== 'stroke') return null;
  const s = obj as StrokeSnap;
  if (s.points === undefined || s.baseWidth === undefined || s.baseHeight === undefined) {
    return null;
  }

  const thickness = PEN_THICKNESS_WORLD[s.thickness];
  const color = s.color in PEN_COLORS ? PEN_COLORS[s.color] : PEN_COLORS.black;

  // The hit tolerance in world units: the larger of half the line width and
  // STROKE_HIT_TOLERANCE_PX screen pixels at this zoom (pen.select).
  const hitHalfWidth = Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);

  // The stroke's own points overflow the bbox by up to the hit width; pad
  // the SVG so they stay inside it (the world layer clips nothing, but the
  // SVG viewport would).
  const pad = hitHalfWidth + 4;
  const ox = s.x - pad;
  const oy = s.y - pad;
  const W = (s.width ?? 0) + 2 * pad;
  const H = (s.height ?? 0) + 2 * pad;

  // Local (SVG) coordinates of the scaled points.
  const worldPts = scaledPoints(s);
  const localPts: Point[] = worldPts.map((p) => ({ x: p.x - ox, y: p.y - oy }));
  const d = smoothPath(localPts);

  const onHitPointerDown = (e: React.PointerEvent<SVGPathElement>): void => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    onPointerDown(e, obj.id);
  };

  return (
    <div
      className={`stroke-object${selected ? ' stroke-object--selected' : ''}`}
      data-testid="stroke-object"
      data-id={obj.id}
      data-selected={selected || undefined}
      style={{
        left: ox,
        top: oy,
        width: W,
        height: H,
        zIndex: obj.z,
        pointerEvents: 'none',
      }}
    >
      <svg
        data-testid="stroke-svg"
        width={W}
        height={H}
        style={{ overflow: 'visible', display: 'block' }}
      >
        {/* Invisible wide hit path: the only part of the stroke that catches
            the pointer (pen.select). Its width is exactly 2× the line hit
            tolerance — never the bbox — so clicks inside the bbox but far
            from the line fall through to objects below. */}
        <path
          data-testid="stroke-hitpath"
          d={d}
          fill="none"
          stroke="rgba(0,0,0,0)"
          strokeWidth={2 * hitHalfWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={onHitPointerDown}
        />
        {/* The visible line: decorative (never catches the pointer). A
            single-point dot is a zero-length round-capped subpath. */}
        <path
          data-testid="stroke-path"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label="Drawing"
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  );
}
