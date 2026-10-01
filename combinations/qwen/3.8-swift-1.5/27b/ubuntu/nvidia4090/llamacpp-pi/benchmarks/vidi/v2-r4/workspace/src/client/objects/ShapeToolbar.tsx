import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/objects/shape';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const swatchStyle = (color: string, active: boolean): React.CSSProperties => ({
  width: 20,
  height: 20,
  borderRadius: 4,
  border: active ? '2px solid #2196F3' : '1px solid #ccc',
  backgroundColor: color,
  cursor: 'pointer',
  display: 'inline-block',
});

export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;

  const fillColors = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
  const strokeColors = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

  return (
    <div
      data-testid="shape-toolbar"
      style={{
        position: 'absolute',
        top: -44,
        left: 0,
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        backgroundColor: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: '6px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span style={{ fontSize: 11, color: '#666', marginRight: 4 }}>Fill:</span>
      {fillColors.map((c) => (
        <button
          key={c}
          aria-label={`${c} fill`}
          title={`${c} fill`}
          style={swatchStyle(SHAPE_FILL_COLORS[c], fill === c)}
          onClick={() => onFill(c)}
        />
      ))}
      <span style={{ fontSize: 11, color: '#666', marginLeft: 8, marginRight: 4 }}>Outline:</span>
      {strokeColors.map((c) => (
        <button
          key={c}
          aria-label={`${c} outline`}
          title={`${c} outline`}
          style={swatchStyle(SHAPE_STROKE_COLORS[c], stroke === c)}
          onClick={() => onStroke(c)}
        />
      ))}
    </div>
  );
}
