import type { CSSProperties, JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';
import { SELECTION_OUTLINE_COLOR } from './stickyStyles';

const barStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: 4,
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 8,
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
  pointerEvents: 'auto'
};

const swatchStyle = (color: string, active: boolean): CSSProperties => ({
  width: 18,
  height: 18,
  padding: 0,
  borderRadius: 4,
  background: color === 'transparent' ? '#ffffff' : color,
  border: active ? `2px solid ${SELECTION_OUTLINE_COLOR}` : '1px solid #b0b6be',
  cursor: 'pointer'
});

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
}

// Shape styling popover (design shape.toolbar): one row of fill swatches and one
// row of outline swatches. Selecting a colour keeps the shape selected.
export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  };
  return (
    <div data-testid="shape-toolbar" style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 'max-content' }}>
      <div style={barStyle} onPointerDown={stop}>
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`${key} fill`}
            title={`${key} fill`}
            aria-pressed={props.fill === key}
            data-testid={`shape-fill-${key}`}
            style={swatchStyle(SHAPE_FILL_COLORS[key], props.fill === key)}
            onClick={() => props.onFill(key)}
          />
        ))}
      </div>
      <div style={barStyle} onPointerDown={stop}>
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`${key} outline`}
            title={`${key} outline`}
            aria-pressed={props.stroke === key}
            data-testid={`shape-stroke-${key}`}
            style={swatchStyle(SHAPE_STROKE_COLORS[key], props.stroke === key)}
            onClick={() => props.onStroke(key)}
          />
        ))}
      </div>
    </div>
  );
}
