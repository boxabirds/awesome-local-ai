/**
 * Floating toolbar for a selected shape (story 10): fill and outline swatches.
 * Rendered in screen space above the shape.
 */
import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

const FILL_LABELS: Record<string, string> = {
  none: 'No',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
};

const STROKE_LABELS: Record<string, string> = {
  dark: 'Dark',
  blue: 'Blue',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  grey: 'Grey',
};

export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}): JSX.Element {
  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="shape-toolbar-label">Fill</span>
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="shape-swatch"
          aria-label={`${FILL_LABELS[c] ?? c} fill`}
          aria-pressed={c === props.fill}
          title={`${FILL_LABELS[c] ?? c} fill`}
          style={{
            backgroundColor: SHAPE_FILL_COLORS[c] === 'transparent' ? 'transparent' : SHAPE_FILL_COLORS[c],
            border: SHAPE_FILL_COLORS[c] === 'transparent' ? '1px dashed #999' : '1px solid #ccc',
          }}
          onClick={() => props.onFill(c)}
        />
      ))}
      <span className="shape-toolbar-label">Outline</span>
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="shape-swatch"
          aria-label={`${STROKE_LABELS[c] ?? c} outline`}
          aria-pressed={c === props.stroke}
          title={`${STROKE_LABELS[c] ?? c} outline`}
          style={{ backgroundColor: SHAPE_STROKE_COLORS[c] }}
          onClick={() => props.onStroke(c)}
        />
      ))}
    </div>
  );
}
