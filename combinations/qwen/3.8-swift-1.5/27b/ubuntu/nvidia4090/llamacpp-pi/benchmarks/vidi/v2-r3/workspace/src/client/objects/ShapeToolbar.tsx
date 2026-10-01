import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill: (c: FillColor) => void;
  onStroke: (c: StrokeColor) => void;
  onDelete: () => void;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FILL_KEYS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_KEYS = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

/**
 * The floating toolbar for a selected shape (story 10, shape.style):
 * six fill swatches (plus "no fill") and six outline swatches.
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke, onDelete }: ShapeToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="shape-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Shape options"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      }}
    >
      {/* Fill row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>Fill</span>
        {FILL_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${capitalize(c)} fill`}
            aria-pressed={fill === c}
            title={`${capitalize(c)} fill`}
            onClick={() => onFill(c)}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: fill === c ? '2px solid #1565C0' : '1px solid rgba(0,0,0,0.2)',
              background: SHAPE_FILL_COLORS[c],
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      {/* Stroke row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, color: '#666', marginRight: 4 }}>Line</span>
        {STROKE_KEYS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${capitalize(c)} outline`}
            aria-pressed={stroke === c}
            title={`${capitalize(c)} outline`}
            onClick={() => onStroke(c)}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: stroke === c ? '2px solid #1565C0' : '1px solid rgba(0,0,0,0.2)',
              background: SHAPE_STROKE_COLORS[c],
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      {/* Delete */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          aria-label="Delete shape"
          title="Delete shape"
          onClick={onDelete}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          <span aria-hidden>🗑</span>
        </button>
      </div>
    </div>
  );
}
