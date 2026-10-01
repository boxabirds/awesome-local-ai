/**
 * StrokeObject (story 11): renders a stroke as an SVG path with round caps/joins.
 */
import React from 'react';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';

export interface StrokeObjectProps {
  stroke: StrokeSnap;
  selected: boolean;
}

export function StrokeObject({ stroke, selected }: StrokeObjectProps) {
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const colorHex = PEN_COLORS[stroke.color];
  const strokeWidth = PEN_THICKNESS_WORLD[stroke.thickness];

  // Render as SVG positioned at the stroke's world coordinates
  return (
    <div
      data-testid="stroke-object"
      data-stroke-id={stroke.id}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        pointerEvents: 'none',
        outline: selected ? '2px solid #1976D2' : undefined,
        outlineOffset: 1,
      }}
    >
      <svg
        width={stroke.width}
        height={stroke.height}
        viewBox={`0 0 ${stroke.width} ${stroke.height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <path
          d={relativePath(d, stroke.x, stroke.y)}
          fill="none"
          stroke={colorHex}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label="Drawing"
        />
      </svg>
    </div>
  );
}

/**
 * Convert an absolute world-space path to one relative to the element's origin.
 */
function relativePath(d: string, offsetX: number, offsetY: number): string {
  // Parse and offset all coordinate pairs in the SVG path
  return d.replace(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g, (_, x, y) => {
    return `${parseFloat(x) - offsetX} ${parseFloat(y) - offsetY}`;
  });
}
