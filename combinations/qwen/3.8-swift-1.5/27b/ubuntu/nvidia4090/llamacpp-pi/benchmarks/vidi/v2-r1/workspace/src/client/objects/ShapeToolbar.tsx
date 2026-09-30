/**
 * Story 10: ShapeToolbar — fill and outline colour swatches.
 */
import {
  SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS,
  type FillColor, type StrokeColor,
} from '@shared/config';

interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill: (c: FillColor) => void;
  onStroke: (c: StrokeColor) => void;
}

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  const fillKeys = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
  const strokeKeys = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

  return (
    <div
      data-testid="shape-toolbar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 8,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {/* Fill swatches */}
      <div style={{ display: 'flex', gap: 4 }}>
        {fillKeys.map((key) => (
          <button
            key={key}
            aria-label={`${key} fill`}
            data-testid={`fill-${key}`}
            onClick={() => onFill(key)}
            style={{
              width: 20,
              height: 20,
              border: fill === key ? '2px solid #2196F3' : '1px solid #ccc',
              borderRadius: 3,
              backgroundColor: SHAPE_FILL_COLORS[key],
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
      {/* Stroke swatches */}
      <div style={{ display: 'flex', gap: 4 }}>
        {strokeKeys.map((key) => (
          <button
            key={key}
            aria-label={`${key} outline`}
            data-testid={`stroke-${key}`}
            onClick={() => onStroke(key)}
            style={{
              width: 20,
              height: 20,
              border: stroke === key ? '2px solid #2196F3' : '1px solid #ccc',
              borderRadius: 3,
              backgroundColor: SHAPE_STROKE_COLORS[key],
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
    </div>
  );
}
