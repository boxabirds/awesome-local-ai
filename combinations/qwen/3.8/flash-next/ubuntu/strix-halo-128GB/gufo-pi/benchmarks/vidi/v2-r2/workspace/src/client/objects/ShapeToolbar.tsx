import type { ReactElement } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '@shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const FILL_LABELS: Record<string, string> = {
  none: 'No fill',
  white: 'White',
  blue: 'Light blue',
  green: 'Light green',
  yellow: 'Light yellow',
  pink: 'Pink',
  grey: 'Grey',
};

const STROKE_LABELS: Record<string, string> = {
  dark: 'Dark',
  blue: 'Blue',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  grey: 'Grey',
};

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): ReactElement {
  return (
    <div
      className="shape-toolbar"
      data-board-ui="true"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 4, background: '#fff', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}
    >
      {/* Fill swatches */}
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((key) => (
        <button
          key={`fill-${key}`}
          aria-label={`${FILL_LABELS[key] ?? key} fill`}
          title={`${FILL_LABELS[key] ?? key} fill`}
          data-testid={`fill-swatch-${key}`}
          onClick={() => onFill(key)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 3,
            border: fill === key ? '2px solid #1E88E5' : '1px solid #ccc',
            background: SHAPE_FILL_COLORS[key] === 'transparent'
              ? 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px'
              : SHAPE_FILL_COLORS[key],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}

      <div style={{ width: 1, height: 20, background: '#ddd', margin: '0 2px' }} />

      {/* Stroke swatches */}
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((key) => (
        <button
          key={`stroke-${key}`}
          aria-label={`${STROKE_LABELS[key] ?? key} outline`}
          title={`${STROKE_LABELS[key] ?? key} outline`}
          data-testid={`stroke-swatch-${key}`}
          onClick={() => onStroke(key)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 3,
            border: stroke === key ? '2px solid #1E88E5' : '1px solid #ccc',
            background: SHAPE_STROKE_COLORS[key],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
