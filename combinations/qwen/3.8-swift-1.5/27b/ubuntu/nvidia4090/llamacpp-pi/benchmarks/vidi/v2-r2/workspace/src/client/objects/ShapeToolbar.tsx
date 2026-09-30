/**
 * Shape toolbar (story 10, shape.ui).
 *
 * Shows fill and outline swatches when a shape is selected.
 */
import type { FillColor, StrokeColor } from '../../shared/config';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';

interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const swatchSize = 20;
const gap = 4;

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape styles"
      style={{
        position: 'absolute',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 20,
      }}
    >
      {/* Fill swatches */}
      <div style={{ display: 'flex', gap, alignItems: 'center' }}>
        <span style={{ fontSize: 11, marginRight: 4, whiteSpace: 'nowrap' }}>Fill</span>
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} fill`}
            data-testid={`fill-${c}`}
            style={{
              width: swatchSize,
              height: swatchSize,
              borderRadius: 4,
              border: c === fill ? '2px solid #2563eb' : '1px solid #d1d5db',
              background: SHAPE_FILL_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={() => onFill(c)}
          />
        ))}
      </div>
      {/* Outline swatches */}
      <div style={{ display: 'flex', gap, alignItems: 'center' }}>
        <span style={{ fontSize: 11, marginRight: 4, whiteSpace: 'nowrap' }}>Outline</span>
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} outline`}
            data-testid={`stroke-${c}`}
            style={{
              width: swatchSize,
              height: swatchSize,
              borderRadius: 4,
              border: c === stroke ? '2px solid #2563eb' : '1px solid #d1d5db',
              background: SHAPE_STROKE_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={() => onStroke(c)}
          />
        ))}
      </div>
    </div>
  );
}
