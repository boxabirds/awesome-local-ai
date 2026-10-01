// src/client/objects/ShapeToolbar.tsx
// Fill and outline colour swatches for a selected shape.

import type { ReactElement } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill: (c: FillColor) => void;
  onStroke: (c: StrokeColor) => void;
}

const fillEntries = Object.entries(SHAPE_FILL_COLORS) as [FillColor, string][];
const strokeEntries = Object.entries(SHAPE_STROKE_COLORS) as [StrokeColor, string][];

export function ShapeToolbar(props: ShapeToolbarProps): ReactElement {
  const { fill, stroke, onFill, onStroke } = props;

  return (
    <div
      data-testid="shape-toolbar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 8,
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Fill swatches */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {fillEntries.map(([name, color]) => (
          <button
            key={name}
            aria-label={`${name} fill`}
            data-testid={`fill-${name}`}
            onClick={() => onFill(name)}
            style={{
              width: 20,
              height: 20,
              border: fill === name ? '2px solid #1E88E5' : '1px solid #999',
              borderRadius: 4,
              background: color,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>

      {/* Outline swatches */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {strokeEntries.map(([name, color]) => (
          <button
            key={name}
            aria-label={`${name} outline`}
            data-testid={`stroke-${name}`}
            onClick={() => onStroke(name)}
            style={{
              width: 20,
              height: 20,
              border: stroke === name ? '2px solid #1E88E5' : '1px solid #999',
              borderRadius: 4,
              background: color,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
