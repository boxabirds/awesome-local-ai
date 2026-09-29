/**
 * Shape renderer (story 10, shape.render).
 *
 * Renders an SVG shape (rect, ellipse, diamond) inside the object's
 * absolute-positioned container. The container is positioned by the
 * registry's `render` function; this component fills it.
 *
 * Visuals (from the design):
 *  - rect: <rect> with fill and stroke
 *  - ellipse: <ellipse> centred in the container
 *  - diamond: <polygon> with 4 vertices at the side midpoints
 *  - label: <text> centred, ellipsis via textLength or CSS
 *  - Selected: blue outline (2px)
 */

import React from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { FillColor, StrokeColor, ShapeKind } from '../../shared/config';
import type { ObjectProps } from './registry';

/**
 * Compute the SVG path/polygon for a diamond given the container width/height.
 */
function diamondPoints(w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  return `${cx},0 ${w},${cy} ${cx},${h} 0,${cy}`;
}

export function ShapeObject(props: ObjectProps) {
  const { obj: o, selected, onObjectPointerDown, onSelect, id } = props as any;
  const kind: ShapeKind = (o.kind as ShapeKind) ?? 'rect';
  const fill: FillColor = (o.fill as FillColor) ?? 'white';
  const stroke: StrokeColor = (o.stroke as StrokeColor) ?? 'dark';
  const label = o.label ?? '';
  const w = o.width ?? 160;
  const h = o.height ?? 160;

  const fillColor = SHAPE_FILL_COLORS[fill] ?? 'white';
  const strokeColor = selected ? '#4285F4' : (SHAPE_STROKE_COLORS[stroke] ?? '#263238');
  const strokeWidth = selected ? SHAPE_STROKE_WIDTH_WORLD + 1 : SHAPE_STROKE_WIDTH_WORLD;

  return (
    <div
      style={{
        position: 'absolute',
        left: o.x,
        top: o.y,
        width: w,
        height: h,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onObjectPointerDown?.(e.nativeEvent, o.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(o.id);
      }}
    >
    <svg
      width={w}
      height={h}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {kind === 'rect' && (
        <rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={w - strokeWidth}
          height={h - strokeWidth}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
      )}
      {kind === 'ellipse' && (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={w / 2 - strokeWidth / 2}
          ry={h / 2 - strokeWidth / 2}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
      )}
      {kind === 'diamond' && (
        <polygon
          points={diamondPoints(w - strokeWidth, h - strokeWidth)}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          transform={`translate(${strokeWidth / 2}, ${strokeWidth / 2})`}
        />
      )}
      {label && (
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: 14,
            fontFamily: 'system-ui, sans-serif',
            fill: '#263238',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {label.length > 20 ? label.slice(0, 20) + '…' : label}
        </text>
      )}
    </svg>
    </div>
  );
}
