import type { JSX } from 'react';
import { objectBounds } from '../../shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { getStrokeSnap, scaledPoints } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

export type StrokeObjectProps = ObjectProps;

// A finished freehand stroke: the stored points scaled to the current box,
// rendered as one smoothed round-capped path. Only the transparent hit path
// (as wide as the selection tolerance) takes pointer events, so clicks
// inside the bounding box but far from the line fall through to whatever is
// underneath. Resizing scales the stored points proportionally while the
// stroke width stays the stored thickness.
export function StrokeObject(props: StrokeObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, editable, onObjectPointerDown } = props;
  const snap = getStrokeSnap(doc, obj.id);
  if (snap === undefined) return <></>;
  const bbox = objectBounds(obj);
  const local = scaledPoints(snap).map((p) => ({ x: p.x - bbox.x, y: p.y - bbox.y }));
  const d = smoothPath(local);
  const w = Math.max(bbox.width, 1);
  const h = Math.max(bbox.height, 1);
  const strokeWidth = PEN_THICKNESS_WORLD[snap.thickness];
  const hitWidth = 2 * Math.max(strokeWidth / 2, STROKE_HIT_TOLERANCE_PX / (zoom || 1));
  return (
    <svg
      data-testid="stroke-object"
      data-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="img"
      aria-label="Drawing"
      className="stroke-object"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ left: bbox.x, top: bbox.y, overflow: 'visible' }}
      pointerEvents="none"
      onDoubleClick={(e) => {
        e.stopPropagation(); // never create a sticky on a drawing
      }}
    >
      <path
        data-testid="stroke-line"
        d={d}
        fill="none"
        stroke={PEN_COLORS[snap.color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={selected ? 1 : 0.95}
        pointerEvents="none"
      />
      <path
        data-testid="stroke-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!editable) return;
          onObjectPointerDown(e as unknown as React.PointerEvent<HTMLElement>, obj.id);
        }}
      />
    </svg>
  );
}
