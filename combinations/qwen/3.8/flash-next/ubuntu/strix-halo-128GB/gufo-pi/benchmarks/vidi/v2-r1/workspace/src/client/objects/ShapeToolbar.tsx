/**
 * ShapeToolbar: fill and outline swatches shown when a shape is selected.
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

/** Display name for fill colours in aria-labels. */
function fillLabel(key: FillColor): string {
  if (key === 'none') return 'No';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Display name for stroke colours in aria-labels. */
function strokeLabel(key: StrokeColor): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): JSX.Element {
  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape style"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="shape-toolbar__group" role="group" aria-label="Fill colour">
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`fill-${key}`}
            aria-label={`${fillLabel(key)} fill`}
            className={`shape-toolbar__swatch ${fill === key ? 'shape-toolbar__swatch--active' : ''}`}
            style={{ backgroundColor: SHAPE_FILL_COLORS[key] }}
            onClick={() => onFill(key)}
          />
        ))}
      </div>
      <div className="shape-toolbar__group" role="group" aria-label="Outline colour">
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`stroke-${key}`}
            aria-label={`${strokeLabel(key)} outline`}
            className={`shape-toolbar__swatch shape-toolbar__swatch--stroke ${stroke === key ? 'shape-toolbar__swatch--active' : ''}`}
            style={{ backgroundColor: SHAPE_STROKE_COLORS[key] }}
            onClick={() => onStroke(key)}
          />
        ))}
      </div>
    </div>
  );
}
