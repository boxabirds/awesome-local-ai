/**
 * ShapeToolbar: fill and outline colour swatches for a selected shape.
 * Six fill swatches (including "no fill") and six outline swatches.
 */
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const FILL_KEYS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_KEYS = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): React.JSX.Element {
  return (
    <div
      data-testid="shape-toolbar"
      className="shape-toolbar"
      style={{
        display: 'flex',
        gap: '4px',
        padding: '4px',
        background: '#fff',
        borderRadius: '4px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Shape style"
    >
      {/* Fill swatches */}
      {FILL_KEYS.map((key) => (
        <button
          key={`fill-${key}`}
          type="button"
          data-testid={`fill-${key}`}
          aria-label={`${key} fill`}
          aria-pressed={fill === key}
          title={`${key} fill`}
          onClick={() => onFill(key)}
          style={{
            width: 20,
            height: 20,
            border: fill === key ? '2px solid #1E88E5' : '1px solid #999',
            borderRadius: '3px',
            cursor: 'pointer',
            background: SHAPE_FILL_COLORS[key] === 'transparent' ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/8px 8px' : SHAPE_FILL_COLORS[key],
            padding: 0,
          }}
        />
      ))}
      {/* Separator */}
      <div style={{ width: 1, background: '#ddd', margin: '0 2px' }} />
      {/* Stroke swatches */}
      {STROKE_KEYS.map((key) => (
        <button
          key={`stroke-${key}`}
          type="button"
          data-testid={`stroke-${key}`}
          aria-label={`${key} outline`}
          aria-pressed={stroke === key}
          title={`${key} outline`}
          onClick={() => onStroke(key)}
          style={{
            width: 20,
            height: 20,
            border: stroke === key ? '3px solid #1E88E5' : '2px solid ' + SHAPE_STROKE_COLORS[key],
            borderRadius: '3px',
            cursor: 'pointer',
            background: '#fff',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
