/**
 * ShapeToolbar (story 10): the single-shape selection bar — six fill colours
 * (plus "no fill") and six outline colours. One click applies the style
 * (setShapeStyle, one LOCAL_ORIGIN update); there is no close button.
 */
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
  const fills = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
  const strokes = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

  return (
    <div className="shape-toolbar" data-vidi6="shape-toolbar">
      <div className="shape-toolbar-row" role="group" aria-label="Fill colour">
        {fills.map((c) => (
          <button
            key={c}
            type="button"
            className="shape-swatch"
            aria-label={`${c} fill`}
            data-vidi6={`shape-fill-${c}`}
            aria-pressed={props.fill === c}
            style={{
              backgroundColor: c === 'none' ? 'transparent' : SHAPE_FILL_COLORS[c],
            }}
            onClick={() => props.onFill(c)}
          />
        ))}
      </div>
      <div className="shape-toolbar-row" role="group" aria-label="Outline colour">
        {strokes.map((c) => (
          <button
            key={c}
            type="button"
            className="shape-swatch"
            aria-label={`${c} outline`}
            data-vidi6={`shape-stroke-${c}`}
            aria-pressed={props.stroke === c}
            style={{ backgroundColor: SHAPE_STROKE_COLORS[c] }}
            onClick={() => props.onStroke(c)}
          />
        ))}
      </div>
    </div>
  );
}
