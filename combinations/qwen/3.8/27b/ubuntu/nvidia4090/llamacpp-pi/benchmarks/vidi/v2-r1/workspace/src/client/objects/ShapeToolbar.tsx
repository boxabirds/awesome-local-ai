// ShapeToolbar (story 10, shape.style): the floating style toolbar shown
// while exactly one shape is selected (and not being edited). Six fill
// swatches plus "no fill" and six outline swatches; clicking one changes
// only that colour key (shape.style).

import type { JSX } from 'react';
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

export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;
  const fills = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
  const strokes = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

  return (
    <div className="shape-toolbar" role="toolbar" aria-label="Shape style">
      <div className="shape-toolbar__group" role="group" aria-label="Fill">
        {fills.map((c) => (
          <button
            key={c}
            type="button"
            className={`shape-toolbar__swatch${c === fill ? ' shape-toolbar__swatch--active' : ''}${
              c === 'none' ? ' shape-toolbar__swatch--none' : ''
            }`}
            data-testid={`shape-fill-${c}`}
            aria-label={`${c} fill`}
            aria-pressed={c === fill}
            style={{ background: SHAPE_FILL_COLORS[c] }}
            onClick={() => onFill(c)}
          />
        ))}
      </div>
      <div className="shape-toolbar__group" role="group" aria-label="Outline">
        {strokes.map((c) => (
          <button
            key={c}
            type="button"
            className={`shape-toolbar__swatch shape-toolbar__swatch--outline${
              c === stroke ? ' shape-toolbar__swatch--active' : ''
            }`}
            data-testid={`shape-stroke-${c}`}
            aria-label={`${c} outline`}
            aria-pressed={c === stroke}
            style={{
              background: '#ffffff',
              boxShadow: `inset 0 0 0 3px ${SHAPE_STROKE_COLORS[c]}`,
            }}
            onClick={() => onStroke(c)}
          />
        ))}
      </div>
    </div>
  );
}
