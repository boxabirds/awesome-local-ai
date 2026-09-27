// Shape toolbar (see spec: shape.style): floating swatches shown while
// exactly one shape is selected. Fill swatches (six colours + no fill) and
// outline swatches (six colours); each applies immediately via
// setShapeStyle, keeping label, size, position and selection (shape.style).
// The label itself is edited on the shape (double-click, story 2 editor).

import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import type { FillColor, ShapeKind, StrokeColor } from '../../shared/objects/shape';

export interface ShapeToolbarProps {
  /** The kind of the selected shape (aria context). */
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
}

const FILL_KEYS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_KEYS = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

const PRETTY: Record<string, string> = {
  none: 'No fill',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
  dark: 'Dark',
  orange: 'Orange',
  red: 'Red',
};

export function ShapeToolbar({ kind, fill, stroke, onFill, onStroke }: ShapeToolbarProps): JSX.Element {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-testid="shape-toolbar"
      className="shape-toolbar"
      role="toolbar"
      aria-label={`${kind} shape options`}
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <span className="shape-toolbar__group" role="group" aria-label="Fill">
        {FILL_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`fill-${key}`}
            aria-label={`${PRETTY[key] ?? key} fill`}
            aria-pressed={fill === key}
            title={`${PRETTY[key] ?? key} fill`}
            className="shape-toolbar__swatch"
            style={{
              backgroundColor: SHAPE_FILL_COLORS[key],
              boxShadow: key === 'none' ? 'inset 0 0 0 1px #b0bec5' : undefined,
            }}
            onClick={() => onFill(key)}
          />
        ))}
      </span>
      <span className="shape-toolbar__group" role="group" aria-label="Outline">
        {STROKE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`stroke-${key}`}
            aria-label={`${PRETTY[key] ?? key} outline`}
            aria-pressed={stroke === key}
            title={`${PRETTY[key] ?? key} outline`}
            className="shape-toolbar__swatch"
            style={{ backgroundColor: SHAPE_STROKE_COLORS[key] }}
            onClick={() => onStroke(key)}
          />
        ))}
      </span>
    </div>
  );
}
