/**
 * StrokeObject renders a freehand stroke (story 11, stroke.object).
 * SVG path with round caps/joins, colour from PEN_COLORS, thickness in world units.
 * Hit area: only clicks near the drawn line select the stroke (line-distance hit test).
 */
import type { JSX } from 'react';
import type { ObjectProps } from './registry';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';

function toStrokeSnap(obj: ObjectProps['obj']): StrokeSnap {
  return {
    ...obj,
    type: 'stroke',
    points: (obj as any).points ?? [],
    baseWidth: (obj as any).baseWidth ?? 1,
    baseHeight: (obj as any).baseHeight ?? 1,
    color: (obj as any).color ?? 'black',
    thickness: (obj as any).thickness ?? 'medium',
  } as StrokeSnap;
}

export function StrokeObject(props: ObjectProps): JSX.Element {
  const { obj, zoom, selected, readOnly } = props;
  const stroke = toStrokeSnap(obj);
  const pts = scaledPoints(stroke);
  const color = PEN_COLORS[stroke.color] ?? '#212121';
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness] ?? 4;
  const width = obj.width ?? stroke.baseWidth;
  const height = obj.height ?? stroke.baseHeight;

  // Convert world-space points to local (relative to object origin)
  const localPts = pts.map((p) => ({ x: p.x - obj.x, y: p.y - obj.y }));
  const localD = smoothPath(localPts);

  // Hit area width in world units: max of half-thickness and hit tolerance / zoom
  const hitWidth = Math.max(thickness, STROKE_HIT_TOLERANCE_PX / zoom);

  return (
    <div
      data-stroke-id={obj.id}
      data-testid="stroke-object"
      role="img"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Visible stroke */}
        <path
          d={localD}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Invisible hit area - only captures events near the line */}
        {!readOnly && (
          <path
            d={localD}
            fill="none"
            stroke="transparent"
            strokeWidth={hitWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'default' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              props.onObjectPointerDown(e, obj.id);
            }}
          />
        )}
      </svg>
      {selected && (
        <div
          style={{
            position: 'absolute',
            inset: '-2px',
            border: '1px dashed #4A90D9',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
