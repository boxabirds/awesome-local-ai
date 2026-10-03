// Shape toolbar: fill and outline swatches (story 10).
// Shown when exactly one shape is selected.

import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  onDelete: () => void;
}

const SWATCH_SIZE = 20;
const GAP = 4;

export function ShapeToolbar({ fill, stroke, onFill, onStroke, onDelete }: ShapeToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="shape-toolbar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Fill swatches */}
      <div style={{ display: 'flex', gap: `${GAP}px`, alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#666', marginRight: '4px' }}>Fill</span>
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} fill`}
            data-testid={`fill-swatch-${c}`}
            onClick={() => onFill(c)}
            style={{
              width: SWATCH_SIZE,
              height: SWATCH_SIZE,
              borderRadius: '4px',
              border: fill === c ? '2px solid #1976D2' : '1px solid #ccc',
              backgroundColor: SHAPE_FILL_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      {/* Stroke swatches */}
      <div style={{ display: 'flex', gap: `${GAP}px`, alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#666', marginRight: '4px' }}>Line</span>
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} outline`}
            data-testid={`stroke-swatch-${c}`}
            onClick={() => onStroke(c)}
            style={{
              width: SWATCH_SIZE,
              height: SWATCH_SIZE,
              borderRadius: '4px',
              border: stroke === c ? '2px solid #1976D2' : '1px solid #ccc',
              backgroundColor: SHAPE_STROKE_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      {/* Delete */}
      <button
        type="button"
        aria-label="Delete shape"
        data-testid="delete-shape-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '16px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
