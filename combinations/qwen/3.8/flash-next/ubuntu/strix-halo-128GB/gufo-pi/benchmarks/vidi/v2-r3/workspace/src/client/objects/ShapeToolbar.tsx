/**
 * ShapeToolbar (story 10): fill and outline swatches for selected shape.
 */
import React from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_FILL_COLOR_NAMES,
  SHAPE_STROKE_COLOR_NAMES,
} from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const FILL_KEYS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_KEYS = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  return (
    <div
      data-testid="shape-toolbar"
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        backgroundColor: '#fff',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* Fill swatches */}
      {FILL_KEYS.map((key) => (
        <button
          key={`fill-${key}`}
          type="button"
          aria-label={`${SHAPE_FILL_COLOR_NAMES[key]} fill`}
          title={`${SHAPE_FILL_COLOR_NAMES[key]} fill`}
          data-testid={`fill-${key}`}
          onClick={() => onFill(key)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: fill === key ? '2px solid #1976D2' : '1px solid #ccc',
            backgroundColor: SHAPE_FILL_COLORS[key],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      {/* Separator */}
      <div style={{ width: 1, backgroundColor: '#ddd', margin: '0 2px' }} />
      {/* Outline swatches */}
      {STROKE_KEYS.map((key) => (
        <button
          key={`stroke-${key}`}
          type="button"
          aria-label={`${SHAPE_STROKE_COLOR_NAMES[key]} outline`}
          title={`${SHAPE_STROKE_COLOR_NAMES[key]} outline`}
          data-testid={`stroke-${key}`}
          onClick={() => onStroke(key)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: stroke === key ? '2px solid #1976D2' : '1px solid #ccc',
            backgroundColor: SHAPE_STROKE_COLORS[key],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
