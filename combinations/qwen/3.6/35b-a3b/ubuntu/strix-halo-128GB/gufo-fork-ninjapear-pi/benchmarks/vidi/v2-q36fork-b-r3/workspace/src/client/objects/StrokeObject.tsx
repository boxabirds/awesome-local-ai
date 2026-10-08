import React from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '@shared/config';
import type { StrokeSnapshot } from '@shared/board-model';
import { scaledPoints } from '@shared/objects/stroke';
import { smoothPath } from '@shared/geometry/simplify';

interface StrokeObjectProps {
  stroke: StrokeSnapshot;
  selected: boolean;
}

const STROKE_OBJECT_STYLE: React.CSSProperties = { pointerEvents: 'auto' };

/**
 * Renders a stroke object as an SVG path with rounded caps/joins.
 * Reads points from the snapshot, scales them to current size, and renders via smoothPath.
 */
export function StrokeObject({ stroke }: StrokeObjectProps) {
  const pts = scaledPoints(stroke);
  const d = smoothPath(pts);

  if (pts.length === 0) return null;

  const thicknessWorld = PEN_THICKNESS_WORLD[stroke.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const fillColor = PEN_COLORS[stroke.color] ?? PEN_COLORS.black;

  // Single point (dot): render a zero-length path that draws as a filled circle at zoom
  if (pts.length === 1) {
    return (
      <path
        d={d}
        stroke={fillColor}
        strokeWidth={thicknessWorld}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        aria-label="Drawing"
        style={STROKE_OBJECT_STYLE}
      />
    );
  }

  return (
    <path
      d={d}
      stroke={fillColor}
      strokeWidth={thicknessWorld}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      aria-label="Drawing"
      style={STROKE_OBJECT_STYLE}
    />
  );
}
