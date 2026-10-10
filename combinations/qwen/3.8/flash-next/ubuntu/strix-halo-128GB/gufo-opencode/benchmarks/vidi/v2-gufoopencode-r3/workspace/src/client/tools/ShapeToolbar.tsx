import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor
} from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(fill: FillColor): void;
  onStroke(stroke: StrokeColor): void;
}

const LABELS: Record<string, string> = {
  none: 'none',
  white: 'white',
  blue: 'blue',
  green: 'green',
  yellow: 'yellow',
  pink: 'pink',
  grey: 'grey',
  dark: 'dark',
  orange: 'orange',
  red: 'red'
};

// Floating toolbar above a single selected shape: six fill swatches plus
// "no fill", and six outline swatches. Clicking one recolours the shape
// without touching its label, size, position or selection.
export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar-swatch shape-toolbar-fill"
          data-testid={`shape-fill-${c}`}
          aria-label={`${LABELS[c]} fill`}
          title={`${LABELS[c]} fill`}
          aria-pressed={c === fill}
          style={{ background: SHAPE_FILL_COLORS[c] }}
          onClick={() => {
            onFill(c);
          }}
        />
      ))}
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar-swatch shape-toolbar-stroke"
          data-testid={`shape-stroke-${c}`}
          aria-label={`${LABELS[c]} outline`}
          title={`${LABELS[c]} outline`}
          aria-pressed={c === stroke}
          style={{ background: SHAPE_STROKE_COLORS[c] }}
          onClick={() => {
            onStroke(c);
          }}
        />
      ))}
    </div>
  );
}
