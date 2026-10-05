/**
 * The stroke component (story 11).
 *
 * One absolutely-positioned SVG per stroke, anchored at the stroke's box and
 * drawing its (world-space) points directly, inside the board's scaled world
 * layer — so zooming scales the drawing with the board, exactly like text on a
 * sticky note.
 *
 * Two paths share the smoothed `d`: a transparent fat one that takes the
 * pointer (the grab target is a line, not a filled box — clicking next to a
 * drawing must hit the board behind it), and the visible ink, which is
 * colour-only. Round caps and joins turn a single stored point into the dot
 * the PRD asks for, with no special-casing.
 */
import type * as React from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../shared/config';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import type { PenThickness } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import type { ObjectTypeSpec } from './registry';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
  camera: Camera;
  onObjectPointerDown(event: React.PointerEvent, snapshot: ObjectSnapshot): void;
}

export function StrokeObject({ stroke, selected, camera, onObjectPointerDown }: StrokeObjectProps) {
  const bounds = objectBounds(stroke);
  const zoom = camera.zoom || 1;
  const d = smoothPath(scaledPoints(stroke));
  // Half the stored thickness, but never thinner than 6 screen px — the same
  // rule as the registry's `hitTest`, so the visible grabbable line and the
  // hit region agree (`pen.select`).
  const hitWidthWorld =
    Math.max(PEN_THICKNESS_WORLD[stroke.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom) * 2;

  return (
    <div
      data-object-id={stroke.id}
      data-object-type="stroke"
      data-selected={selected ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={Math.max(1, bounds.width)}
        height={Math.max(1, bounds.height)}
        role="img"
        aria-label="Drawing"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {/* World coordinates go in untransformed; the group shifts them into
            this element's local frame the same way the connector does. */}
        <g transform={`translate(${-bounds.x}, ${-bounds.y})`}>
          <path
            d={d}
            data-object-body=""
            data-testid={`stroke-hit-${stroke.id}`}
            fill="none"
            stroke="rgba(0, 0, 0, 0.001)"
            strokeWidth={hitWidthWorld}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'default' }}
            onPointerDown={(event) => onObjectPointerDown(event, stroke)}
          />
          <path
            d={d}
            data-testid={`stroke-line-${stroke.id}`}
            fill="none"
            stroke={PEN_COLORS[stroke.color]}
            strokeWidth={PEN_THICKNESS_WORLD[stroke.thickness]}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      </svg>
    </div>
  );
}

/**
 * How close to a drawing a click must be to select it (`pen.select`): the
 * larger of half the stored thickness and 6 screen pixels converted to world
 * units (`STROKE_HIT_TOLERANCE_PX / zoom`), so a thin line stays clickable at
 * any zoom. `StrokeObject` draws its invisible grab path with exactly this
 * width — the rule lives here, the renderer copies it.
 */
export function hitTestStroke(object: ObjectSnapshot, at: Point, zoom = 1): boolean {
  const stroke = object as Partial<StrokeSnap>;
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return false;
  const distance = distanceToPolyline(scaledPoints(stroke as StrokeSnap), at);
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness as PenThickness];
  const halfThickness = typeof thickness === 'number' ? thickness / 2 : 0;
  return distance <= Math.max(halfThickness, STROKE_HIT_TOLERANCE_PX / (zoom || 1));
}

export const strokeObjectType: ObjectTypeSpec = {
  Component: function StrokeType(props) {
    const { snapshot, camera, selection, onObjectPointerDown } = props;
    return (
      <StrokeObject
        stroke={snapshot as StrokeSnap}
        camera={camera}
        selected={selection.selected}
        onObjectPointerDown={onObjectPointerDown}
      />
    );
  },
  // A drawing can be moved (the generic body path) and resized from a corner
  // — but only proportionally, so the picture keeps its shape (`pen.resize`).
  resizable: true,
  aspectLocked: true,
  editableText: false,
  minSize: STROKE_MIN_SIZE_WORLD,
  hitTest: hitTestStroke,
};
