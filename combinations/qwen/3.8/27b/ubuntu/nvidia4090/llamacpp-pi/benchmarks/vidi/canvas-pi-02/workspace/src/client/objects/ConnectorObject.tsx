/**
 * Connector renderer (story 10, connector.render).
 *
 * Renders an SVG line with an arrowhead. The connector is NOT rendered
 * inside an object container; it's placed in a global SVG overlay in the
 * world layer so it can span any board region.
 *
 * Visuals:
 *  - Line: 2px solid, dark grey
 *  - Arrowhead: filled triangle, 10 world units, at the `to` end
 *  - Selected: blue outline
 */

import React from 'react';
import type { Point } from '../canvas/camera';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';

interface ConnectorObjectProps {
  from: Point;
  to: Point;
  selected: boolean;
}

/**
 * Compute the arrowhead polygon points for an arrow pointing from `from`
 * to `to`. The arrowhead is a filled triangle at the `to` end.
 */
function arrowheadPoints(from: Point, to: Point, size: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return '';
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular unit vector.
  const px = -uy;
  const py = ux;
  // Arrowhead base points.
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const p1x = bx + px * size * 0.5;
  const p1y = by + py * size * 0.5;
  const p2x = bx - px * size * 0.5;
  const p2y = by - py * size * 0.5;
  return `${to.x},${to.y} ${p1x},${p1y} ${p2x},${p2y}`;
}

export function ConnectorObject({ from, to, selected }: ConnectorObjectProps) {
  const color = selected ? '#4285F4' : '#37474F';
  const strokeW = selected ? CONNECTOR_STROKE_WIDTH_WORLD + 1 : CONNECTOR_STROKE_WIDTH_WORLD;
  const headPoints = arrowheadPoints(from, to, CONNECTOR_ARROWHEAD_SIZE_WORLD);

  // Shorten the line so it doesn't overlap the arrowhead.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  let lineEndX = to.x;
  let lineEndY = to.y;
  if (len > CONNECTOR_ARROWHEAD_SIZE_WORLD) {
    const ux = dx / len;
    const uy = dy / len;
    lineEndX = to.x - ux * CONNECTOR_ARROWHEAD_SIZE_WORLD * 0.8;
    lineEndY = to.y - uy * CONNECTOR_ARROWHEAD_SIZE_WORLD * 0.8;
  }

  return (
    <g data-testid="connector-object">
      <line
        x1={from.x}
        y1={from.y}
        x2={lineEndX}
        y2={lineEndY}
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      {headPoints && (
        <polygon points={headPoints} fill={color} />
      )}
    </g>
  );
}
