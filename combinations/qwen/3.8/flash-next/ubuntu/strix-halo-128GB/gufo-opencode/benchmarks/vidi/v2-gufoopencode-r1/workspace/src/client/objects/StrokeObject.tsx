import type { PointerEvent as ReactPointerEvent, JSX } from 'react';
import { isStrokeObject } from '../../shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

// Story 11 renderer (design stroke.render): the recorded path drawn as one
// smoothed SVG curve inside the object's bbox. The path scales with the bbox
// (aspect-locked resize), the ink width never does. Clicks land only on the
// line (plus the hit tolerance), never inside the empty bbox area, and a
// pointer-down on the line starts the shared select/move gesture.
export function StrokeObject(props: ObjectProps): JSX.Element {
  const { obj, zoom, selected } = props;
  const z = zoom > 0 ? zoom : 1;
  if (!isStrokeObject(obj)) {
    return <div data-testid={`stroke-${obj.id}`} style={{ display: 'none' }} />;
  }
  const stroke = obj;
  const color = PEN_COLORS[stroke.color];
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];

  const worldPoints = scaledPoints(stroke);
  const local = worldPoints.map((p) => ({ x: p.x - stroke.x, y: p.y - stroke.y }));
  const d = smoothPath(local);
  const isDot = local.length === 1;
  const hitRadius = Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / z);

  const beginDrag = (event: ReactPointerEvent<SVGElement>): void => {
    event.stopPropagation();
    // The shared gesture handler is typed for HTMLElement targets; SVG paths
    // only use clientX/clientY/pointerId, so the widening is safe here.
    props.onObjectPointerDown(event as unknown as ReactPointerEvent<HTMLElement>, obj.id);
  };

  return (
    <div
      data-testid={`stroke-${obj.id}`}
      data-selected={selected}
      data-first-x={worldPoints[0]?.x}
      data-first-y={worldPoints[0]?.y}
      data-last-x={worldPoints[worldPoints.length - 1]?.x}
      data-last-y={worldPoints[worldPoints.length - 1]?.y}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        pointerEvents: 'none',
        zIndex: obj.z
      }}
    >
      <svg
        width={stroke.width}
        height={stroke.height}
        viewBox={`0 0 ${stroke.width} ${stroke.height}`}
        role="img"
        aria-label="Drawing"
        style={{ overflow: 'visible' }}
      >
        {isDot ? (
          <circle
            data-testid={`stroke-hit-${obj.id}`}
            cx={local[0].x}
            cy={local[0].y}
            r={hitRadius}
            fill="transparent"
            style={{ pointerEvents: 'fill', cursor: 'move' }}
            onPointerDown={beginDrag}
          />
        ) : (
          <path
            data-testid={`stroke-hit-${obj.id}`}
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={hitRadius * 2}
            strokeLinecap="round"
            style={{ pointerEvents: 'stroke', cursor: 'move' }}
            onPointerDown={beginDrag}
          />
        )}
        {isDot ? (
          <circle cx={local[0].x} cy={local[0].y} r={thickness / 2} fill={color} style={{ pointerEvents: 'none' }} />
        ) : (
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>
    </div>
  );
}
