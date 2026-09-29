// The shape toolbar (story 10, shape.style): shown above a single selected
// shape; fill swatches (six colours + no fill) and outline swatches.

import type { ReactElement } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  disabled?: boolean;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

function cap(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function ShapeToolbar(props: ShapeToolbarProps): ReactElement {
  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="shape-toolbar-group" role="group" aria-label="Fill">
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="shape-swatch"
            aria-label={`${cap(c)} fill`}
            aria-pressed={props.fill === c}
            disabled={props.disabled}
            style={
              c === 'none'
                ? { background: 'repeating-conic-gradient(#b6bcc6 0% 25%, transparent 0% 50%) 0 0 / 8px 8px' }
                : { background: SHAPE_FILL_COLORS[c] }
            }
            onClick={() => props.onFill(c)}
          />
        ))}
      </div>
      <div className="shape-toolbar-group" role="group" aria-label="Outline">
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="shape-swatch"
            aria-label={`${cap(c)} outline`}
            aria-pressed={props.stroke === c}
            disabled={props.disabled}
            style={{ background: SHAPE_STROKE_COLORS[c] }}
            onClick={() => props.onStroke(c)}
          />
        ))}
      </div>
    </div>
  );
}
