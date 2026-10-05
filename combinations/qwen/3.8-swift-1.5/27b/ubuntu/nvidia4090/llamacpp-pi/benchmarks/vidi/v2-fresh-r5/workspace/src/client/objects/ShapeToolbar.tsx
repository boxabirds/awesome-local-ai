/**
 * Shape toolbar (story 10). Fill and outline colour swatches for a selected shape.
 */
import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill: (c: FillColor) => void;
  onStroke: (c: StrokeColor) => void;
}

const swatchStyle = (active: boolean, color: string): React.CSSProperties => ({
  width: '20px',
  height: '20px',
  borderRadius: '4px',
  border: active ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.3)',
  background: color,
  cursor: 'pointer',
  padding: 0,
});

/**
 * Toolbar with fill and outline colour swatches for a selected shape.
 */
export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;

  return (
    <div
      data-testid="shape-toolbar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {/* Fill swatches */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', marginRight: '4px', color: '#666' }}>Fill</span>
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} fill`}
            data-testid={`fill-${c}`}
            onClick={() => onFill(c)}
            style={swatchStyle(fill === c, SHAPE_FILL_COLORS[c])}
          />
        ))}
      </div>
      {/* Outline swatches */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', marginRight: '4px', color: '#666' }}>Outline</span>
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} outline`}
            data-testid={`stroke-${c}`}
            onClick={() => onStroke(c)}
            style={swatchStyle(stroke === c, SHAPE_STROKE_COLORS[c])}
          />
        ))}
      </div>
    </div>
  );
}
