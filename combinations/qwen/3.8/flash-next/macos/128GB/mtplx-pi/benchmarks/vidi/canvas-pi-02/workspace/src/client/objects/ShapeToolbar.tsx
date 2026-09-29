/**
 * Shape toolbar (story 10): fill and outline colour swatches.
 */
import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const fillKeys = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
  const strokeKeys = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

  return (
    <div
      data-testid="shape-toolbar"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 4, background: '#fff', border: '1px solid #ccc', borderRadius: 4 }}
    >
      <div style={{ display: 'flex', gap: 2 }}>
        {fillKeys.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`${key} fill`}
            aria-pressed={props.fill === key}
            style={{
              width: 16,
              height: 16,
              background: SHAPE_FILL_COLORS[key] === 'transparent' ? '#eee' : SHAPE_FILL_COLORS[key],
              border: props.fill === key ? '2px solid #333' : '1px solid #999',
              borderRadius: 2,
              cursor: 'pointer',
            }}
            onClick={() => props.onFill(key)}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {strokeKeys.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`${key} outline`}
            aria-pressed={props.stroke === key}
            style={{
              width: 16,
              height: 16,
              background: SHAPE_STROKE_COLORS[key],
              border: props.stroke === key ? '2px solid #333' : '1px solid #999',
              borderRadius: 2,
              cursor: 'pointer',
            }}
            onClick={() => props.onStroke(key)}
          />
        ))}
      </div>
    </div>
  );
}
