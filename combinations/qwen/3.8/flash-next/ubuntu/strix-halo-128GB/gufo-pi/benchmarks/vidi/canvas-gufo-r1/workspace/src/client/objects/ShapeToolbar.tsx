import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const FILL_ENTRIES = Object.entries(SHAPE_FILL_COLORS) as [FillColor, string][];
const STROKE_ENTRIES = Object.entries(SHAPE_STROKE_COLORS) as [StrokeColor, string][];

export function ShapeToolbar(props: ShapeToolbarProps) {
  const { fill, stroke, onFill, onStroke } = props;

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      style={{ display: 'flex', gap: 4, padding: '4px 8px', background: '#fff', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', alignItems: 'center' }}
    >
      {/* Fill swatches */}
      <span style={{ fontSize: 11, color: '#666' }}>Fill:</span>
      {FILL_ENTRIES.map(([key, color]) => (
        <button
          key={`fill-${key}`}
          type="button"
          aria-label={`${key} fill`}
          data-testid={`fill-${key}`}
          onClick={() => onFill(key)}
          style={{
            width: 20,
            height: 20,
            border: fill === key ? '2px solid #1E88E5' : '1px solid #ccc',
            borderRadius: 3,
            background: color === 'transparent' ? 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px' : color,
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <span style={{ width: 8 }} />
      {/* Stroke swatches */}
      <span style={{ fontSize: 11, color: '#666' }}>Outline:</span>
      {STROKE_ENTRIES.map(([key, color]) => (
        <button
          key={`stroke-${key}`}
          type="button"
          aria-label={`${key} outline`}
          data-testid={`stroke-${key}`}
          onClick={() => onStroke(key)}
          style={{
            width: 20,
            height: 20,
            border: stroke === key ? '2px solid #1E88E5' : '1px solid #ccc',
            borderRadius: 3,
            background: color,
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
