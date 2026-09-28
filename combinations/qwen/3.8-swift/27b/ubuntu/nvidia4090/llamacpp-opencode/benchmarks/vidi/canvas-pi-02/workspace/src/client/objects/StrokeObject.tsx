// A freehand stroke on the board (story 11, pen.share / pen.resize /
// pen.select): rendered in world coordinates in the world layer. The SVG's
// viewBox is the BASE (creation-time) bbox and its size the CURRENT bbox,
// so resizing scales the line proportionally while the stored points and
// thickness never change (pen.resize).
//
// Pointer interaction (select, move, resize) is delegated to the GENERIC
// transform gesture (story 7) via onPointerDown. The container is
// pointer-events: none so empty space inside the (padded) bbox still
// reaches the board (marquee / double-click); only the line itself is
// clickable, via a wide transparent "hit" path (pointer-events: stroke)
// whose width is the larger of the stroke thickness and
// 2 × STROKE_HIT_TOLERANCE_PX / zoom (pen.select). While the Pen tool is
// active the board passes a no-op so the pen draws over strokes (pen.draw).
// Strokes are not text-editable and are never in an editing state.

import { type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { strokeSnapshot, type StrokeSnap } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

/** Base-size path for a stroke: the stored relative points (flat
 *  [x0, y0, ...]) as a smooth path in the viewBox coordinate space. */
export function strokeBasePath(points: readonly number[]): string {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i += 2) {
    pts.push({ x: points[i], y: points[i + 1] });
  }
  return smoothPath(pts);
}

export function StrokeObject(props: ObjectProps): ReactElement | null {
  const { obj, doc, selected, dragging, zoom } = props;
  // The extended snapshot comes from the renderer; a defensive re-read
  // covers any path that renders without it.
  const snap: StrokeSnap | null = props.stroke ?? strokeSnapshot(doc, obj.id);
  if (snap === null) return null;

  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const baseWidth = snap.baseWidth || width;
  const baseHeight = snap.baseHeight || height;
  const d = strokeBasePath(snap.points);
  const thickness = PEN_THICKNESS_WORLD[snap.thickness];
  const color = PEN_COLORS[snap.color];
  // Hit width in CURRENT world units: the larger of the visible thickness
  // and the screen tolerance; converted to viewBox units (scaled by
  // baseWidth / width, matching the line itself).
  const hitWorld = 2 * Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  const hitWidthViewBox = width !== 0 ? hitWorld * (baseWidth / width) : hitWorld;

  return (
    <div
      role="group"
      aria-label="Sketch"
      data-testid="stroke-object"
      data-id={obj.id}
      data-color={snap.color}
      data-thickness={snap.thickness}
      data-selected={selected ? 'true' : undefined}
      className={`stroke-object${selected ? ' stroke-object--selected' : ''}${
        selected && dragging ? ' stroke-object--dragging' : ''
      }`}
      tabIndex={0}
      style={{ left: obj.x, top: obj.y, width, height, pointerEvents: 'none' }}
      onFocus={() => {
        if (!selected) props.onSelect(obj.id); // Tab-reachable strokes are selectable
      }}
    >
      <svg
        className="stroke-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${baseWidth} ${baseHeight}`}
        aria-hidden="true"
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* The clickable line: a wide transparent stroke with the same
            geometry (pen.select tolerance). Zero-length dot paths hit-test
            as their round cap. */}
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidthViewBox}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          onPointerDown={(e: ReactPointerEvent<SVGPathElement>) => props.onPointerDown(e, obj.id)}
        />
      </svg>
    </div>
  );
}
